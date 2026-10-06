import type { Locator, Page } from '@playwright/test';
import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { nodesResponse, prId, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { mockDetail } from './helpers/detailData';
import { authored } from './helpers/listData';

const API = { id: prId(912, 'acme/api'), ref: 'acme/api#912', title: /^Add rate limiting/ };

const sections = (): Section[] =>
  defaultSettings().sections.map((s) => ({ ...s, enabled: s.kind === 'authored' }));
const list = (panel: Page) => panel.getByRole('list', { name: 'Created by me pull requests' });
/** The card titled `title` inside `scope` (the page, or one of its lists). */
const card = (scope: Page | Locator, title: RegExp) => {
  const page = 'page' in scope ? scope.page() : scope;
  return scope.locator('.pr-card', { has: page.getByRole('link', { name: title }) });
};
const menuOf = async (panel: Page, title: RegExp) => {
  await card(panel, title)
    .getByRole('button', { name: /^More actions for / })
    .click();
  return panel.getByRole('menu');
};

test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse(authored, variables));
  github.onGraphQL('ProwlNodes', (variables) => nodesResponse(variables.ids, []));
  mockDetail(github);
  await seedStorage({ settings: { sections: sections() } });
  await signIn();
  await poll();
  for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
});

test('snoozes a pull request out of the list and the badge, and back', async ({
  openPanel,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  await expect(card(list(panel), API.title)).toHaveCount(1);
  const before = await serviceWorker.evaluate(() => chrome.action.getBadgeText({}));

  let menu = await menuOf(panel, API.title);
  await expect(menu).toBeVisible();
  await expectNoA11yViolations(panel);
  // axe moves focus while it scans, which closes the menu (focus left it).
  if (!(await menu.isVisible())) menu = await menuOf(panel, API.title);
  await menu.getByRole('menuitem', { name: 'Snooze for 4 hours' }).click();
  await expect(card(list(panel), API.title)).toHaveCount(0);
  const snoozed = panel.getByRole('button', { name: 'Snoozed (1)' });
  await expect(snoozed).toHaveAttribute('aria-expanded', 'false');
  // #912 is ready to merge, so it counted toward the badge.
  await expect
    .poll(() => serviceWorker.evaluate(() => chrome.action.getBadgeText({})))
    .toBe(String(Number(before) - 1 || ''));

  await snoozed.click();
  const hidden = panel.getByRole('list', { name: 'Snoozed Created by me pull requests' });
  await expect(card(hidden, API.title)).toContainText(/\d{1,2}:\d{2}/);
  await expectNoA11yViolations(panel);
  await (await menuOf(panel, API.title)).getByRole('menuitem', { name: 'Unsnooze' }).click();
  await expect(card(list(panel), API.title)).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /^Snoozed/ })).toHaveCount(0);
});

test('mutes a pull request, copies its branch and opens it on GitHub', async ({
  context,
  openPanel,
  serviceWorker,
}) => {
  const panel = await openPanel();
  await (await menuOf(panel, API.title))
    .getByRole('menuitem', { name: 'Mute notifications' })
    .click();
  await expect(card(panel, API.title).getByText('Notifications muted')).toBeAttached();
  const local = await serviceWorker.evaluate(() => chrome.storage.local.get('prLocal'));
  expect(local.prLocal).toMatchObject({ muted: { [API.id]: true } });

  await (await menuOf(panel, API.title))
    .getByRole('menuitem', { name: /^Copy branch name/ })
    .click();
  await expect(panel.getByRole('region', { name: 'Messages' })).toContainText(
    /Copied |Could not copy/,
  );

  const opened = context.waitForEvent('page');
  await (await menuOf(panel, API.title)).getByRole('menuitem', { name: 'Open in GitHub' }).click();
  expect((await opened).url()).toMatch(/\/acme\/api\/pull\/912$/);
});
