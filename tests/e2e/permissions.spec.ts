import { assertManifestLocked, type LockedBuild, lockedAccess } from '../fixtures/manifestLock';
import { expect, launchExtension, PRODUCTION_PATH, test } from './fixtures';

/** What Chrome itself reports for a loaded extension: the manifest it parsed and what it granted. */
const READ_ACCESS = async () => ({
  manifest: chrome.runtime.getManifest(),
  granted: await chrome.permissions.getAll(),
});

/** The lock, checked on the loaded extension rather than on the manifest source. */
function expectLocked(
  { manifest, granted }: Awaited<ReturnType<typeof READ_ACCESS>>,
  build: LockedBuild,
) {
  assertManifestLocked(manifest, build);
  const { permissions, host_permissions } = lockedAccess(build);
  // Nothing optional has been granted: the sign-in flow has not run.
  expect([...(granted.permissions ?? [])].sort()).toEqual([...permissions].sort());
  expect([...(granted.origins ?? [])].sort()).toEqual([...host_permissions].sort());
}

test('the e2e build can touch no page and no site but its mock GitHub', async ({
  serviceWorker,
}) => {
  expectLocked(await serviceWorker.evaluate(READ_ACCESS), 'e2e');
});

// The e2e build points at the mock server. This one is the build the store ships, loaded the way
// Chrome loads it, so a manifest Chrome reads differently from the source shows up here.
test('the production build can touch no page and no site but GitHub', async () => {
  const context = await launchExtension(PRODUCTION_PATH);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await expect
      .poll(() => worker.evaluate(() => typeof chrome !== 'undefined' && !!chrome.runtime?.id), {
        intervals: [50, 100, 250],
        timeout: 5_000,
      })
      .toBe(true);
    const access = await worker.evaluate(READ_ACCESS);
    expect(access.manifest.name).toBe('Prowl');
    expectLocked(access, 'production');
  } finally {
    await context.close();
  }
});
