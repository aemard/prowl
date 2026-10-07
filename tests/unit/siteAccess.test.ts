// @vitest-environment node
/**
 * Prowl cannot read or change the pages a user visits. Chrome decides that from the manifest, so
 * the manifest is locked (tests/fixtures/manifestLock.ts), the docs must name what it allows, and
 * the code must not use the one thing a GitHub host permission still lets an extension see.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createManifest } from '../../src/manifest';
import {
  assertManifestLocked,
  HOSTS,
  type LockedBuild,
  lockedAccess,
  PERMISSIONS,
} from '../fixtures/manifestLock';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('manifest lock', () => {
  it.each(['production', 'e2e'] as const)('holds for the %s build', (build) => {
    expect(() => assertManifestLocked(createManifest(build), build)).not.toThrow();
  });

  it('lists exactly the permissions the story promises for the shipped build', () => {
    expect(lockedAccess('production')).toEqual({
      permissions: ['sidePanel', 'storage', 'alarms', 'notifications'],
      host_permissions: ['https://api.github.com/*'],
      optional_host_permissions: ['https://github.com/*'],
    });
  });

  const base = () => ({ ...createManifest('production') }) as Record<string, unknown>;
  const withPermission = (name: string) => ({
    permissions: [...lockedAccess('production').permissions, name],
  });

  it.each([
    ['a content script', { content_scripts: [{ matches: ['<all_urls>'], js: ['x.js'] }] }],
    ['web_accessible_resources', { web_accessible_resources: [{ resources: ['a'], matches: [] }] }],
    ['externally_connectable', { externally_connectable: { matches: ['https://*/*'] } }],
    ['declarative_net_request', { declarative_net_request: { rule_resources: [] } }],
    ['optional_permissions', { optional_permissions: ['tabs'] }],
    ['a commands key (US-040 allows it on purpose, in manifestLock.ts)', { commands: {} }],
    ['the tabs permission', withPermission('tabs')],
    ['the scripting permission', withPermission('scripting')],
    ['the activeTab permission', withPermission('activeTab')],
    ['the declarativeNetRequest permission', withPermission('declarativeNetRequest')],
    ['a missing permission', { permissions: ['sidePanel', 'storage', 'alarms'] }],
    ['all sites', { host_permissions: ['https://api.github.com/*', '<all_urls>'] }],
    ['all of github.com', { host_permissions: ['https://*.github.com/*'] }],
    ['an optional host on every site', { optional_host_permissions: ['*://*/*'] }],
    ['no optional host', { optional_host_permissions: undefined }],
  ])('fails when the manifest gains or loses %s', (_what, change) => {
    // The message names what to update, whatever changed.
    expect(() => assertManifestLocked({ ...base(), ...change }, 'production')).toThrow(
      /docs\/privacy\.md[\s\S]*docs\/decisions\.md/,
    );
  });

  it('explains why a dangerous key is refused', () => {
    expect(() => assertManifestLocked({ ...base(), content_scripts: [] }, 'production')).toThrow(
      /"content_scripts" \(runs code inside web pages\)/,
    );
  });

  it('ignores the order of a list', () => {
    const [first, ...rest] = lockedAccess('production').permissions;
    expect(() =>
      assertManifestLocked({ ...base(), permissions: [...rest, first] }, 'production'),
    ).not.toThrow();
  });

  it('keeps the e2e build to the mock server and nothing optional', () => {
    const build: LockedBuild = 'e2e';
    expect(lockedAccess(build).host_permissions).toEqual([
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/\*$/),
    ]);
    expect(lockedAccess(build).optional_host_permissions).toEqual([]);
  });
});

describe('documentation', () => {
  // Wherever the guarantee is stated, it names every permission and host the lock allows: adding
  // one without writing it down fails here. (Removing one is caught by the lock above.)
  const documents = [
    'docs/privacy.md',
    'README.md',
    'docs/chrome-web-store.md',
    'site/src/pages/index.astro',
  ];

  it.each(documents)('%s names every permission and host', (path) => {
    const text = read(path);
    const missing = [...PERMISSIONS, ...HOSTS].filter(
      (name) => !text.includes(`\`${name}\``) && !text.includes(`<code>${name}</code>`),
    );
    expect(missing, `${path} must name these permissions in code font`).toEqual([]);
  });
});

describe('source code', () => {
  const files = readdirSync(resolve(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter(
      (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.startsWith('test'),
    )
    .map((path) => [path, read(`src/${path}`)] as const);

  it('reads the shipped files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  // A host permission also lets an extension read the address and title of the tabs on that host
  // through chrome.tabs. Prowl only ever opens tabs; it never asks for them.
  it('only opens tabs, it never queries or listens to them', () => {
    const uses = files.flatMap(([path, text]) =>
      [...text.matchAll(/chrome\.tabs\.(\w+)/g)]
        .filter(([, member]) => member !== 'create')
        .map(([use]) => `${path}: ${use}`),
    );
    expect(uses).toEqual([]);
  });

  it('uses no API that reads or changes pages', () => {
    const pattern =
      /chrome\.(scripting|webNavigation|webRequest|declarativeNetRequest|cookies|history|debugger|tabCapture|desktopCapture|pageCapture)\b/;
    expect(files.filter(([, text]) => pattern.test(text)).map(([path]) => path)).toEqual([]);
  });
});
