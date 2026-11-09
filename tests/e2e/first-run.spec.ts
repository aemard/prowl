import { defaultSettings } from '../../src/lib/storage/settings';
import { expect, test } from './fixtures';

test('fresh install opens the full list, enables notifications and remembers dismissal', async ({
  signIn,
  poll,
  seedStorage,
  openPanel,
  expectNoA11yViolations,
}) => {
  await signIn();
  await seedStorage({
    settings: defaultSettings(),
    onboarding: { status: 'pending', nextStep: 1 },
  });
  await poll();
  const page = await openPanel();
  await expect(page.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'Following pull requests you opened and reviews asked of you. Notifications are off.',
    ),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { notifications?: { enabled?: boolean } };
      };
      return settings?.notifications?.enabled;
    }),
  ).toBe(true);
});

test('first-run team action enables Team reviews and Got it persists', async ({
  signIn,
  poll,
  seedStorage,
  openPanel,
}) => {
  await signIn();
  await seedStorage({
    settings: defaultSettings(),
    onboarding: { status: 'pending' },
    teams: {
      login: 'octocat',
      fetchedAt: new Date().toISOString(),
      error: null,
      teams: [{ org: 'acme', slug: 'core', name: 'Core' }],
    },
  });
  await poll();
  const page = await openPanel();
  await expect(page.getByText(/You're in 1 team ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Show Team reviews' }).click();
  await expect(page.getByRole('tab', { name: /^Teams/ })).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  // The dismissal is stored asynchronously; reload only once it took effect.
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
});
