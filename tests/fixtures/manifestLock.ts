/**
 * The site-access lock: everything the manifest may ask Chrome for.
 *
 * Prowl promises that it cannot read or change the pages a user visits (docs/privacy.md).
 * Chrome enforces that through the manifest alone, so the manifest is held to this list by the
 * unit tests (`tests/unit/siteAccess.test.ts`) and by the E2E tests on the built extensions
 * (`tests/e2e/permissions.spec.ts`).
 *
 * Changing what Prowl asks Chrome for is a deliberate act: edit the list below, the permission
 * table in docs/privacy.md and a line in docs/decisions.md in the same commit.
 */
import { E2E_ORIGIN } from '../../src/manifest';

export type LockedBuild = 'production' | 'e2e';

/**
 * Top-level manifest keys. A key that is not here fails the lock, so a new capability (a content
 * script, a rule file, an `externally_connectable` list, a `commands` entry...) cannot slip in
 * next to a permission. To allow one, add its name here (one line).
 */
export const ALLOWED_KEYS = [
  'manifest_version',
  'name',
  'short_name',
  'description',
  'version',
  'minimum_chrome_version',
  'icons',
  'action',
  'side_panel',
  // Keyboard shortcuts only (US-040): no access to pages or data. docs/privacy.md says so.
  'commands',
  'background',
  'permissions',
  'host_permissions',
  'optional_host_permissions',
  'content_security_policy',
];

/** Why the keys that matter most are never allowed; shown in the failure message. */
const RISK: Record<string, string> = {
  content_scripts: 'runs code inside web pages',
  web_accessible_resources: 'lets web pages load files of the extension',
  externally_connectable: 'lets web pages and other extensions message the extension',
  declarative_net_request: 'rules that block or redirect requests of any site',
  optional_permissions: 'permissions the user can be asked for later',
};

/** The named permissions, in the order docs/privacy.md lists them. */
export const PERMISSIONS = ['sidePanel', 'storage', 'alarms', 'notifications'];

/** The GitHub hosts of a production build, as the docs name them. */
export const HOSTS = ['api.github.com', 'github.com'];

/**
 * What the manifest holds per key. The E2E build swaps api.github.com for the mock server and has
 * no optional host: the device flow talks to that same origin, which is already granted.
 */
export function lockedAccess(build: LockedBuild) {
  return {
    permissions: PERMISSIONS,
    host_permissions: [build === 'e2e' ? `${E2E_ORIGIN}/*` : 'https://api.github.com/*'],
    optional_host_permissions: build === 'e2e' ? [] : ['https://github.com/*'],
  };
}

const sameList = (actual: unknown, expected: string[]) =>
  Array.isArray(actual) &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

/** What differs between `manifest` and the lock; empty when it holds. */
export function manifestViolations(manifest: object, build: LockedBuild): string[] {
  const found = manifest as Record<string, unknown>;
  const problems = Object.keys(found)
    .filter((key) => !ALLOWED_KEYS.includes(key))
    .map((key) => `key "${key}"${RISK[key] ? ` (${RISK[key]})` : ''} is not allowed`);
  for (const [key, expected] of Object.entries(lockedAccess(build))) {
    const actual = found[key] ?? [];
    if (!sameList(actual, expected)) {
      problems.push(
        `${key} is ${JSON.stringify(actual)}, it must be exactly ${JSON.stringify(expected)}`,
      );
    }
  }
  return problems;
}

/** Throws, with what to do about it, unless `manifest` is exactly what the lock allows. */
export function assertManifestLocked(manifest: object, build: LockedBuild): void {
  const problems = manifestViolations(manifest, build);
  if (problems.length === 0) return;
  throw new Error(
    [
      'The manifest asks Chrome for something the site-access lock does not allow:',
      ...problems.map((problem) => `  - ${problem}`),
      "Prowl promises users that it cannot read or change the pages they visit. If this change is deliberate, update docs/privacy.md (the permission table: what it allows and what Chrome's install prompt shows) and docs/decisions.md in the same commit, then tests/fixtures/manifestLock.ts.",
    ].join('\n'),
  );
}
