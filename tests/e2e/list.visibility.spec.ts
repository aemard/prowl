import { searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import {
  AUTHORED,
  allSections,
  barTop,
  box,
  cardFor,
  enableRepositoryGrouping,
  expectRepositoryKeyboardFolding,
  recordMessages,
  stored,
  tabNames,
} from './helpers/listAssertions';
import { nodesFor } from './helpers/listData';

test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(nodesFor(variables.query), variables),
  );
  await seedStorage({ settings: { groupByRepo: false, sections: allSections() } });
  await signIn();
  await poll();
  // `poll()` leaves the page it sent from open, and it would mark cards seen like a panel.
  for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
});

test('with a rich set of pull requests › hides pull requests with no commit for 20 days behind a button at the end', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  const stale = /^Experiment: lazy-load/;
  await expect(panel.getByRole('listitem')).toHaveCount(7);
  await expect(cardFor(panel, stale)).toHaveCount(0);
  expect(await tabNames(panel)).toEqual(['Mine7', 'Review3', 'Mentions1', 'Assigned2']);

  // After the last card, above the bar.
  const show = panel.getByRole('button', { name: 'Show 1 hidden' });
  await show.scrollIntoViewIfNeeded();
  const last = await box(panel.locator('.pr-card').last());
  expect((await box(show)).y).toBeGreaterThanOrEqual(last.y + last.height);
  expect((await box(show)).y + (await box(show)).height).toBeLessThanOrEqual(await barTop(panel));

  await show.click();
  const again = panel.getByRole('button', { name: 'Hide again' });
  await expect(again).toBeFocused();
  await expect(again).toHaveAttribute('aria-expanded', 'true');
  const revealed = panel.getByRole('list', { name: 'Hidden Created by me pull requests' });
  await expect(revealed.getByRole('listitem')).toHaveCount(1);
  await expect(cardFor(panel, stale)).toContainText('No commit for 34 d');
  await expect(cardFor(panel, stale).locator('[data-pr-id]')).toHaveAttribute(
    'data-pr-id',
    AUTHORED.stale,
  );
  // Not counted, even when shown.
  await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine7');
  await revealed.scrollIntoViewIfNeeded();
  await panel.emulateMedia({ colorScheme: 'light' });
  await expectNoA11yViolations(panel);
  await panel.screenshot({ path: test.info().outputPath('hidden-light.png') });
  await panel.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(panel);
  await panel.screenshot({ path: test.info().outputPath('hidden-dark.png') });

  // Revealed for the session: still there after a visit to Settings.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();
  await expect(cardFor(panel, stale)).toBeVisible();

  await panel.getByRole('button', { name: 'Hide again' }).click();
  await expect(cardFor(panel, stale)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Show 1 hidden' })).toBeFocused();
});

test('with a rich set of pull requests › a new number of days in Settings applies at once, and 0 hides nothing', async ({
  openPanel,
}) => {
  const panel = await openPanel();
  const days = async (value: string) => {
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByLabel('Hide PRs with no commit for (days)').fill(value);
    await panel.getByRole('button', { name: 'Back to pull requests' }).click();
  };

  // Commits 7 and 34 days old in Mine, 8 days in Assigned; Mentions' is 5 days old.
  await days('6');
  await expect.poll(() => tabNames(panel)).toEqual(['Mine6', 'Review3', 'Mentions1', 'Assigned1']);
  await expect(panel.getByRole('button', { name: 'Show 2 hidden' })).toBeAttached();
  await expect(cardFor(panel, /^Dark mode: fix contrast/)).toHaveCount(0);

  await days('0');
  await expect.poll(() => tabNames(panel)).toEqual(['Mine8', 'Review3', 'Mentions1', 'Assigned3']);
  await expect(panel.getByRole('listitem')).toHaveCount(8);
  await expect(panel.getByRole('button', { name: /hidden/ })).toHaveCount(0);
  await expect(cardFor(panel, /^Experiment: lazy-load/)).not.toContainText('No commit');
});

test('with a rich set of pull requests › hides drafts with a switch in Settings, and reveals them with the other hidden PRs', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  const draft = /^WIP: migrate to Postgres 16/;
  const hidden = (count: number) => panel.getByRole('button', { name: `Show ${count} hidden` });
  // A draft shows like any other PR until the switch is on.
  await expect(cardFor(panel, draft)).toBeVisible();
  await expect(hidden(1)).toBeAttached();

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const hideDrafts = panel.getByRole('switch', { name: 'Hide draft PRs' });
  await expect(hideDrafts).toHaveAttribute('aria-checked', 'false');
  await expect(panel.getByRole('switch', { name: 'Hide PRs opened by bots' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expectNoA11yViolations(panel);
  await hideDrafts.click();
  await expect(hideDrafts).toHaveAttribute('aria-checked', 'true');
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();

  // Out of the cards and the count; the stale PR and the draft share the one button.
  await expect(cardFor(panel, draft)).toHaveCount(0);
  await expect(panel.getByRole('listitem')).toHaveCount(6);
  await expect.poll(() => tabNames(panel)).toEqual(['Mine6', 'Review3', 'Mentions1', 'Assigned2']);
  await hidden(2).click();
  const revealed = panel.getByRole('list', { name: 'Hidden Created by me pull requests' });
  await expect(revealed.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine6');
  // Its own "Draft" chip says why, so nothing is printed twice.
  await expect(cardFor(panel, draft).getByText('Draft', { exact: true })).toHaveCount(1);
  await expect(cardFor(panel, draft).getByTitle('Why it is hidden from the list')).toHaveCount(0);
  await expect(
    cardFor(panel, /^Experiment: lazy-load/).getByTitle('Why it is hidden from the list'),
  ).toHaveText('No commit for 34 d');
  await panel.emulateMedia({ colorScheme: 'light' });
  await expectNoA11yViolations(panel);
  await panel.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(panel);

  // Off again: the draft is back among the cards.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('switch', { name: 'Hide draft PRs' }).click();
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();
  await expect.poll(() => tabNames(panel)).toEqual(['Mine7', 'Review3', 'Mentions1', 'Assigned2']);
  await expect(
    panel.getByRole('list', { name: 'Created by me pull requests', exact: true }),
  ).toContainText('WIP: migrate to Postgres 16');
});

test('with a rich set of pull requests › hides bot PRs with a switch, and every reason sits behind the one button', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  const [vite, eslint, moment] = [/^Bump vite/, /^Bump eslint/, /^Replace moment/];
  const why = (title: RegExp) => cardFor(panel, title).getByTitle('Why it is hidden from the list');
  await panel.getByRole('tab', { name: /^Assigned/ }).click();

  // Dependabot's PR shows like any other; only the one with no commit for 41 days is hidden.
  await expect(panel.getByRole('tab', { selected: true })).toHaveText('Assigned2');
  await expect(cardFor(panel, vite)).toBeVisible();
  await expect(cardFor(panel, moment)).toBeVisible();
  await panel.getByRole('button', { name: 'Show 1 hidden' }).click();
  await expect(why(eslint)).toHaveText('No commit for 41 d');
  await panel.getByRole('button', { name: 'Hide again' }).click();

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('switch', { name: 'Hide PRs opened by bots' }).click();
  await expect(panel.getByRole('switch', { name: 'Hide PRs opened by bots' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();

  // Still the Assigned tab: one card left, one button for both bots.
  await expect(cardFor(panel, vite)).toHaveCount(0);
  await expect(cardFor(panel, moment)).toBeVisible();
  await expect.poll(() => tabNames(panel)).toEqual(['Mine7', 'Review3', 'Mentions1', 'Assigned1']);
  await expect(panel.getByRole('button', { name: /hidden/ })).toHaveCount(1);
  await panel.getByRole('button', { name: 'Show 2 hidden' }).click();
  const revealed = panel.getByRole('list', { name: 'Hidden Assigned to me pull requests' });
  await expect(revealed.getByRole('listitem')).toHaveCount(2);
  await expect(why(vite)).toHaveText('Bot');
  await expect(why(eslint)).toHaveText('Bot, No commit for 41 d');
  await expect(panel.getByRole('tab', { selected: true })).toHaveText('Assigned1');
  await panel.emulateMedia({ colorScheme: 'light' });
  await expectNoA11yViolations(panel);
  await panel.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(panel);

  // The other tabs have no bots: nothing changed there.
  await panel.getByRole('tab', { name: /^Review/ }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
});

test('with a rich set of pull requests › groups pull requests by repository with its own switch, and folds a group', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  const headers = panel.locator('.repo-group__heading');
  const header = (repo: string) => panel.getByRole('button', { name: new RegExp(`^${repo} \\d`) });
  const rateLimit = /^Add rate limiting middleware/;
  await expect(headers).toHaveCount(0);

  await enableRepositoryGrouping(panel);

  // One header per repository, in the order of its newest PR; the count of the bar is unchanged.
  await expect(headers).toHaveText([
    'acme/web2 pull requests',
    'acme/api2 pull requests',
    'acme/mobile1 pull request',
    'octo/docs1 pull request',
    'northwind-engineering/internal-platform-services-monorepo1 pull request',
  ]);
  await expect(header('acme/web')).toHaveAttribute('aria-expanded', 'true');
  const web = panel.getByRole('list', { name: 'acme/web pull requests' });
  await expect(web.getByRole('listitem')).toHaveCount(2);
  await expect(web.locator('.pr-card__repo').first()).toHaveText('#2481');
  await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine7');
  // The long name is cut by the strip (full name in the tooltip), never by scrolling sideways.
  const long = header('northwind-engineering/internal-platform-services-monorepo');
  await expect(long.locator('.repo-group__name')).toHaveAttribute(
    'title',
    'northwind-engineering/internal-platform-services-monorepo',
  );
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await expectRepositoryKeyboardFolding(panel, header, rateLimit);

  // The quick filter narrows the groups and their counts; a folded group stays folded.
  const filter = panel.getByRole('searchbox', { name: 'Filter pull requests' });
  await filter.fill('acme/web');
  await expect(headers).toHaveText(['acme/web2 pull requests']);
  await filter.fill('rate limiting');
  await expect(headers).toHaveText(['acme/api1 pull request']);
  await expect(header('acme/api')).toHaveAttribute('aria-expanded', 'false');
  await filter.fill('');
  await expect(headers).toHaveCount(5);

  // Hidden PRs keep their own button and list: flat, with the repository on each card.
  await panel.getByRole('button', { name: 'Show 1 hidden' }).click();
  const revealed = panel.getByRole('list', { name: 'Hidden Created by me pull requests' });
  await expect(revealed.locator('.repo-group__heading')).toHaveCount(0);
  await expect(revealed.locator('.pr-card__repo')).toHaveText('acme/web#2311');
  await expect(headers).toHaveCount(5);

  // Folded state lasts for the session: through Settings and back.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();
  await expect(header('acme/api')).toHaveAttribute('aria-expanded', 'false');
  await header('acme/api').click();
  await expect(cardFor(panel, rateLimit)).toBeVisible();

  await panel.emulateMedia({ colorScheme: 'light' });
  await expectNoA11yViolations(panel);
  await panel.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(panel);
});

test('with a rich set of pull requests › does not mark the cards of a folded group as seen', async ({
  openPanel,
  seedStorage,
  serviceWorker,
}) => {
  await seedStorage({ settings: { sections: allSections(), groupByRepo: true } });
  const messages = await recordMessages(serviceWorker);
  const panel = await openPanel();
  const checkout = panel.locator(`[data-pr-id="${AUTHORED.checkout}"]`);
  const rateLimit = panel.locator(`[data-pr-id="${AUTHORED.rateLimit}"]`);
  await panel.getByRole('button', { name: /^acme\/api \d/ }).click();
  await expect(rateLimit).toHaveCount(0);

  await expect(checkout).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
  const marked = (await messages()).filter((m) => m.type === 'markSeen').flatMap((m) => m.prIds);
  expect(marked).toContain(AUTHORED.checkout);
  expect(marked).not.toContain(AUTHORED.rateLimit);
  expect(marked).not.toContain(AUTHORED.draft);

  // Unfolded, they are on screen and get marked like any card.
  await panel.getByRole('button', { name: /^acme\/api \d/ }).click();
  await expect(rateLimit).toHaveAttribute('data-unseen', 'true');
  await expect(rateLimit).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
});

test('with a rich set of pull requests › marks the cards on screen as seen after 1.5 s, and the others once scrolled to', async ({
  openPanel,
  serviceWorker,
}) => {
  const messages = await recordMessages(serviceWorker);
  const panel = await openPanel();
  const checkout = panel.locator(`[data-pr-id="${AUTHORED.checkout}"]`);
  const contrast = panel.locator(`[data-pr-id="${AUTHORED.contrast}"]`);
  await expect(checkout).toHaveAttribute('data-unseen', 'true');
  await expect(contrast).toHaveAttribute('data-unseen', 'true');
  await expect(contrast).not.toBeInViewport();

  await panel.waitForTimeout(800);
  expect((await messages()).filter((m) => m.type === 'markSeen')).toEqual([]);

  await expect(checkout).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
  const [first] = (await messages()).filter((m) => m.type === 'markSeen');
  expect(first?.prIds).toContain(AUTHORED.checkout);
  expect(first?.prIds).not.toContain(AUTHORED.contrast);
  await expect(contrast).toHaveAttribute('data-unseen', 'true');
  const { prLocal } = await stored(serviceWorker);
  expect(Object.keys(prLocal?.seen ?? {})).toContain(AUTHORED.checkout);
  expect(Object.keys(prLocal?.seen ?? {})).not.toContain(AUTHORED.contrast);

  await contrast.scrollIntoViewIfNeeded();
  await expect(contrast).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
});

test('with a rich set of pull requests › does not mark anything seen while the panel is hidden', async ({
  openPanel,
  serviceWorker,
}) => {
  const messages = await recordMessages(serviceWorker);
  const panel = await openPanel();
  await panel.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await panel.waitForTimeout(2_200);
  expect((await messages()).filter((m) => m.type === 'markSeen')).toEqual([]);
});
