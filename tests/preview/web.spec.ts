import { expect, test } from '@playwright/test';

test('mock website supports details, comments and settings without GitHub requests', async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://localhost:5174') && !request.url().startsWith('data:')) {
      external.push(request.url());
    }
  });
  await page.goto('/');
  await expect(page.getByText('Add keyboard shortcuts', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Details for Add keyboard shortcuts', exact: true })
    .click();
  await page.locator('summary').filter({ hasText: 'passed' }).click();
  await expect(page.getByText('Unit tests', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Comment on acme/web#101', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('A comment from the website preview');
  await dialog.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Commented on acme/web#101', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to pull requests', exact: true }).click();
  await expect(page.getByText('Add keyboard shortcuts', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
