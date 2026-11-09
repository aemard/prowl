import { defaultSettings } from '../../src/lib/storage/settings';
import { expect, test } from './fixtures';

test('fresh install lands on the list without a note', async ({
  signIn,
  poll,
  seedStorage,
  openPanel,
  expectNoA11yViolations,
}) => {
  await signIn();
  await seedStorage({ settings: defaultSettings() });
  await poll();
  const page = await openPanel();
  await expect(page.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
  await expectNoA11yViolations(page);
  await page.reload();
  await expect(page.getByRole('main', { name: 'Pull requests' })).toBeVisible();
});
