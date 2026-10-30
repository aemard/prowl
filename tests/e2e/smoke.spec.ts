import { expect, test } from './fixtures';

test('loads the extension and renders the side panel', async ({
  serviceWorker,
  openPanel,
  expectNoA11yViolations,
}) => {
  expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.side_panel?.default_path).toBe('sidepanel/index.html');

  const panel = await openPanel();
  await expect(panel.getByRole('heading', { name: 'Prowl' })).toBeVisible();
  await expectNoA11yViolations(panel);
});

test('Chrome refuses HTML strings in the panel (Trusted Types)', async ({ openPanel }) => {
  const panel = await openPanel();
  const refused = await panel.evaluate(() => {
    try {
      document.createElement('div').innerHTML = '<img src=x>';
      return false;
    } catch (error) {
      return error instanceof TypeError;
    }
  });
  expect(refused).toBe(true);
});
