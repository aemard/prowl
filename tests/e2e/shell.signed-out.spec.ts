import { expect, test } from './fixtures';

test.describe('signed out', () => {
  test('lands on onboarding, whatever the hash', async ({ openPanel, expectNoA11yViolations }) => {
    const panel = await openPanel('#/settings');
    await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect(panel.getByRole('main', { name: 'Sign in' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
    await expectNoA11yViolations(panel);
  });

  test('shows a skeleton until storage has been read', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.addInitScript(() => {
      const read = chrome.storage.local.get.bind(chrome.storage.local);
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      Object.assign(window, { releaseStorage: open });
      chrome.storage.local.get = (async (...args: Parameters<typeof read>) => {
        await gate;
        return read(...args);
      }) as typeof chrome.storage.local.get;
    });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
    await expect(panel.getByRole('main', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toHaveCount(0);

    await panel.evaluate(() => (window as unknown as { releaseStorage(): void }).releaseStorage());
    await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect(panel.getByRole('main', { name: 'Loading' })).toHaveCount(0);
  });
});
