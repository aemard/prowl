import { expect, test } from '@playwright/test';

test('preview buttons animate cards in and out without toasts or replay on refresh', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Add keyboard shortcuts', { exact: true })).toBeVisible();
  await expect(page.locator('.pr-card[data-activity]')).toHaveCount(0);
  for (const [button, kind] of [
    ['New PR', 'new'],
    ['Merge PR', 'merged'],
    ['Close PR', 'closed'],
  ]) {
    const before = await page.locator('.pr-card').count();
    await page.getByRole('button', { name: button, exact: true }).click();
    const card = page.locator(`.pr-card[data-activity="${kind}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.pr-card__activity')).toBeVisible();
    if (kind !== 'new') await expect(card).toHaveAttribute('inert', '');
    await expect(card).toHaveCount(0);
    await expect(page.locator('.pr-card')).toHaveCount(before + (kind === 'new' ? 1 : -1));
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.pr-card[data-activity]')).toHaveCount(0);
  await expect(page.locator('.ui-toast')).toHaveCount(0);
});

test('card updates respect reduced motion and keep new cards after the highlight', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'New PR', exact: true }).click();
  const card = page.locator('.pr-card[data-activity="new"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('animation-name', 'none');
  await expect(card.locator('.pr-card__activity')).toHaveText('Just opened');
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Polish the little details #106', { exact: true })).toBeVisible();
});
