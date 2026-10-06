import type { Page } from '@playwright/test';
import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { nodesResponse, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { mockDetail } from './helpers/detailData';
import { authored } from './helpers/listData';

const sections = (): Section[] =>
  defaultSettings().sections.map((s) => ({ ...s, enabled: s.kind === 'authored' }));
const toggles = (panel: Page) => panel.locator('.pr-list .pr-card__toggle');

test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse(authored, variables));
  github.onGraphQL('ProwlNodes', (variables) => nodesResponse(variables.ids, []));
  mockDetail(github);
  await seedStorage({ settings: { sections: sections() } });
  await signIn();
  await poll();
  for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
});

test('drives the list from the keyboard', async ({ context, github, openPanel }) => {
  const panel = await openPanel();
  await expect(toggles(panel).first()).toBeVisible();

  await panel.keyboard.press('j');
  await expect(toggles(panel).nth(0)).toBeFocused();
  await panel.keyboard.press('j');
  await panel.keyboard.press('ArrowDown');
  await expect(toggles(panel).nth(2)).toBeFocused();
  await panel.keyboard.press('k');
  await expect(toggles(panel).nth(1)).toBeFocused();

  // Enter expands the focused card; Escape folds it back.
  await panel.keyboard.press('Enter');
  await expect(toggles(panel).nth(1)).toHaveAttribute('aria-expanded', 'true');
  await panel.keyboard.press('Escape');
  await expect(toggles(panel).nth(1)).toHaveAttribute('aria-expanded', 'false');

  // o opens the focused pull request on GitHub.
  const opened = context.waitForEvent('page');
  await panel.keyboard.press('o');
  expect((await opened).url()).toMatch(/\/acme\/api\/pull\/912$/);
  await panel.bringToFront();

  // / jumps to the filter, and typing there is not a shortcut.
  await panel.keyboard.press('/');
  const filter = panel.getByRole('searchbox', { name: 'Filter pull requests' });
  await expect(filter).toBeFocused();
  await panel.keyboard.type('jr');
  await expect(filter).toHaveValue('jr');
  await filter.fill('');

  // r refreshes and announces the outcome.
  const before = github.requestsFor('ProwlSearch').length;
  // Leave the field: letters typed there are text, not shortcuts.
  await panel.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await panel.keyboard.press('r');
  await expect.poll(() => github.requestsFor('ProwlSearch').length).toBeGreaterThan(before);
  await expect(panel.locator('[role="status"][aria-live="polite"]').last()).toHaveText(
    /^Updated\. \d+ pull requests\.$/,
  );
});

test('lists the shortcuts, and every screen is accessible in both themes', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  await expect(toggles(panel).first()).toBeVisible();
  await panel.keyboard.press('?');
  const dialog = panel.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toContainText('Open the focused pull request on GitHub');

  for (const scheme of ['light', 'dark'] as const) {
    await panel.emulateMedia({ colorScheme: scheme });
    await expectNoA11yViolations(panel);
  }
  await panel.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The list with an expanded card, then Settings, in both themes.
  await toggles(panel).first().click();
  for (const scheme of ['light', 'dark'] as const) {
    await panel.emulateMedia({ colorScheme: scheme });
    await expectNoA11yViolations(panel);
  }
  await panel.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await expect(panel.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await panel.emulateMedia({ colorScheme: scheme });
    await expectNoA11yViolations(panel);
  }
});
