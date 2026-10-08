import type { Locator, Page, Worker } from '@playwright/test';
import type { PrLocalState, Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { prId, searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { authored, nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

/** Every preset but Team reviews, whose data and tests live in teams.spec.ts. */
const allSections = (): Section[] =>
  defaultSettings().sections.map((section) => ({
    ...section,
    enabled: section.kind !== 'team_review_requested',
  }));

/** Ids of the authored PRs, newest activity first (the default sort). */
const AUTHORED = {
  checkout: prId(2481, 'acme/web'),
  rateLimit: prId(912, 'acme/api'),
  draft: prId(905, 'acme/api'),
  conflicts: prId(377, 'acme/mobile'),
  badges: prId(58, 'octo/docs'),
  deps: prId(1042, 'northwind-engineering/internal-platform-services-monorepo'),
  contrast: prId(2470, 'acme/web'),
  /** No commit for 34 days: hidden by default. */
  stale: prId(2311, 'acme/web'),
};

const tabNames = (panel: Page) => panel.getByRole('tab').allTextContents();
const box = async (locator: Locator) =>
  (await locator.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
/** Top and bottom edges of the section bar, in CSS px from the top of the panel. */
const barTop = async (panel: Page) => (await box(panel.locator('[data-bottom-bar]'))).y;
const barBottom = async (panel: Page) => {
  const bar = await box(panel.locator('[data-bottom-bar]'));
  return bar.y + bar.height;
};
const linkFor = (panel: Page, title: RegExp) => panel.getByRole('link', { name: title });
/** The card (`li`) of the pull request whose title link matches. */
const cardFor = (panel: Page, title: RegExp) =>
  panel.locator('.pr-card', { has: linkFor(panel, title) });
const stored = (worker: Worker) =>
  worker.evaluate(() => chrome.storage.local.get('prLocal') as Promise<{ prLocal?: PrLocalState }>);

/** Collects what the side panel sends to the service worker. */
async function recordMessages(worker: Worker) {
  await worker.evaluate(() => {
    const received: { type: string; prIds?: string[] }[] = [];
    Object.assign(globalThis, { received });
    chrome.runtime.onMessage.addListener((message) => {
      received.push(message);
    });
  });
  return () =>
    worker.evaluate(
      () => (globalThis as unknown as { received: { type: string; prIds?: string[] }[] }).received,
    );
}

test.describe('with a rich set of pull requests', () => {
  test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
    github.onGraphQL('ProwlSearch', (variables) =>
      searchResponse(nodesFor(variables.query), variables),
    );
    await seedStorage({ settings: { sections: allSections() } });
    await signIn();
    await poll();
    // `poll()` leaves the page it sent from open, and it would mark cards seen like a panel.
    for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
  });

  test('shows the sections in a bar at the bottom, with counts, and switches between them', async ({
    openPanel,
  }) => {
    const panel = await openPanel();
    await expect(panel.getByRole('tab')).toHaveCount(4);
    expect(await tabNames(panel)).toEqual(['Mine7', 'Review3', 'Mentions1', 'Assigned2']);
    await expect(panel.getByRole('tab', { name: /^Mine/ })).toHaveAttribute(
      'title',
      'Created by me',
    );
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine7');
    await expect(panel.getByRole('tabpanel', { name: 'Created by me' })).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(7);

    // Header and filter on top, the bar at the bottom edge, and the list ends above the bar.
    const filter = await box(panel.getByRole('searchbox'));
    expect(await barTop(panel)).toBeGreaterThan(filter.y + filter.height);
    expect(await barBottom(panel)).toBe(760);
    await panel.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => barBottom(panel)).toBe(760);
    const last = await box(panel.locator('.pr-card').last());
    expect(last.y + last.height).toBeLessThanOrEqual(await barTop(panel));

    await panel.getByRole('tab', { name: /^Review/ }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await expect(cardFor(panel, /^Add keyboard shortcuts/)).toBeVisible();

    // Arrow keys move between tabs, like any tab list.
    await panel.getByRole('tab', { selected: true }).press('ArrowRight');
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mentions1');
    await expect(cardFor(panel, /^Spike: edge-render/)).toBeVisible();
    await panel.getByRole('tab', { selected: true }).press('End');
    await expect(panel.getByRole('tab', { name: /^Assigned/ })).toBeFocused();
    await panel.keyboard.press('Home');
    await expect(panel.getByRole('tab', { name: /^Mine/ })).toBeFocused();
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine7');
  });

  test('fits 320 to 600 px wide panels, with the sections past the fourth under "More"', async ({
    openPanel,
    seedStorage,
    expectNoA11yViolations,
  }) => {
    const custom = (id: string, label: string): Section => ({
      id,
      kind: 'custom',
      label,
      enabled: true,
      query: 'label:none',
    });
    const long = custom('custom-1', 'Needs attention from the platform team this week');
    await seedStorage({ settings: { sections: [...allSections(), long] } });
    const panel = await openPanel();
    const fits = () =>
      panel.evaluate(() => {
        const page = document.documentElement;
        const items = [...document.querySelectorAll('[data-bottom-bar] button')];
        return (
          page.scrollWidth <= page.clientWidth &&
          items.every((item) => {
            const { left, right } = item.getBoundingClientRect();
            return left >= 0 && right <= page.clientWidth;
          })
        );
      });

    // Five sections: five tabs. A long custom name is cut short on screen, whole for a screen reader.
    await expect(panel.getByRole('tab')).toHaveCount(5);
    const named = panel.getByRole('tab', { name: `${long.label} 0` });
    await expect(named).toHaveAttribute('title', long.label);
    expect(
      await named.locator('.section-tabs__label').evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    for (const width of [600, 400, 320]) {
      await panel.setViewportSize({ width, height: 760 });
      expect(await fits(), `${width} px`).toBe(true);
    }
    await panel.screenshot({ path: test.info().outputPath('bar-320-five.png') });

    // A sixth: the fifth slot becomes "More", a menu with the rest and their counts.
    await seedStorage({
      settings: { sections: [...allSections(), long, custom('custom-2', 'Docs')] },
    });
    await expect(panel.getByRole('tab')).toHaveCount(4);
    const more = panel.getByRole('button', { name: /^More sections/ });
    for (const width of [600, 400, 320]) {
      await panel.setViewportSize({ width, height: 760 });
      expect(await fits(), `${width} px`).toBe(true);
    }
    await more.click();
    const menu = panel.getByRole('menu', { name: 'More sections' });
    await expect(menu.getByRole('menuitemradio')).toHaveText([`${long.label}0`, 'Docs0']);
    const menuBox = await box(menu);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(await barTop(panel));
    await menu.getByRole('menuitemradio', { name: /^Docs/ }).click();

    // "More" now stands for the section shown: indicator and weight on screen, its name in words.
    await expect(more).toHaveAccessibleName('More sections, Docs selected');
    await expect(more).toBeFocused();
    await expect(panel.getByRole('tab', { selected: true })).toHaveCount(0);
    await expect(panel.getByRole('tabpanel', { name: 'Docs' })).toBeVisible();
    await expect(panel.getByText('No open pull requests match this search.')).toBeVisible();

    // Keyboard: the filter, then the one tab stop of the tab list, then "More".
    await panel.getByRole('searchbox').focus();
    await panel.keyboard.press('Tab');
    await expect(panel.getByRole('tab', { name: /^Mine/ })).toBeFocused();
    await panel.keyboard.press('Tab');
    await expect(more).toBeFocused();
    await panel.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitemradio', { name: /^Docs/ })).toBeFocused();
    await expect(menu.getByRole('menuitemradio', { name: /^Docs/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await panel.keyboard.press('Escape');
    await expect(more).toBeFocused();

    for (const scheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: scheme });
      await expectNoA11yViolations(panel);
      await panel.screenshot({ path: test.info().outputPath(`bar-320-more-${scheme}.png`) });
    }
    await panel.setViewportSize({ width: 600, height: 760 });
    await panel.getByRole('tab', { name: /^Review/ }).click();
    await panel.screenshot({ path: test.info().outputPath('bar-600.png') });
  });

  test('keeps menus, toasts and keyboard focus clear of the bar', async ({ openPanel }) => {
    const panel = await openPanel();
    await panel.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const top = await barTop(panel);

    // The last card's menu has no room below it above the bar: it opens upward.
    const trigger = panel.getByRole('button', { name: /^More actions for / }).last();
    await trigger.click();
    const menu = panel.getByRole('menu');
    const menuBox = await box(menu);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(top);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual((await box(trigger)).y);

    // Its outcome toast sits above the bar.
    await menu
      .getByRole('menuitem', { name: /^Snooze/ })
      .first()
      .click();
    const toast = panel.locator('.ui-toast');
    await expect(toast).toContainText('Snoozed');
    const toastBox = await box(toast);
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(top);

    // Focus never hides behind the bar: a control focused while under it scrolls above it,
    // whether focus came from Tab or from j on the card before.
    const toggle = panel.locator('.pr-list .pr-card__toggle').last();
    for (const move of ['focus', 'j'] as const) {
      await panel.evaluate(() => {
        const toggles = document.querySelectorAll<HTMLElement>('.pr-list .pr-card__toggle');
        toggles[toggles.length - 2]?.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      });
      const under = (await box(toggle)).y - (top + 8);
      await panel.evaluate((y) => window.scrollTo(0, y), under);
      expect((await box(toggle)).y).toBeGreaterThan(top);
      if (move === 'focus') await toggle.focus();
      else await panel.keyboard.press('j');
      await expect(toggle).toBeFocused();
      const focused = await box(toggle);
      expect(focused.y + focused.height, move).toBeLessThanOrEqual(top);
    }
  });

  test('a card says everything about its pull request, and not by color alone', async ({
    openPanel,
  }) => {
    const panel = await openPanel();

    const checkout = cardFor(panel, /^Refactor checkout flow/);
    const title = linkFor(panel, /^Refactor checkout flow/);
    await expect(title).toHaveAttribute('href', `${MOCK_ORIGIN}/acme/web/pull/2481`);
    await expect(checkout).toContainText('acme/web');
    await expect(checkout).toContainText('#2481');
    await expect(checkout).toContainText('2 failing');
    await expect(checkout).toContainText('Changes requested');
    await expect(checkout).toContainText('4 unresolved');
    await expect(checkout).toContainText('Opened 9 d ago');
    await expect(checkout).toContainText('bug');
    await expect(checkout).toContainText('+1');
    await expect(checkout).toContainText(/\d+ min ago/);
    // The link is named by the title and where it lives; the expand button describes the rest.
    expect(await title.getAttribute('aria-label')).toMatch(
      /^Refactor checkout flow .*, acme\/web#2481$/,
    );
    const toggle = checkout.getByRole('button', { name: /^Details for Refactor checkout flow/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const describedBy = (await toggle.getAttribute('aria-describedby')) ?? '';
    const facts = (await panel.locator(`[id="${describedBy}"]`).textContent()) ?? '';
    expect(facts).toMatch(/^acme\/web#2481, by octocat\. /);
    expect(facts).toContain('Checks failing: 2 failed, 11 passed, 1 skipped (14 checks)');
    expect(facts).toContain('4 unresolved threads. 12 comments');
    expect(facts).toContain('Labels: bug, needs-design, area/checkout, regression');

    await expect(cardFor(panel, /^WIP: migrate/)).toContainText('Draft');
    await expect(cardFor(panel, /^WIP: migrate/)).toContainText('3 pending');
    await expect(cardFor(panel, /^Fix crash when rotating/)).toContainText('Conflicts');
    await expect(cardFor(panel, /^Add rate limiting/)).toContainText('Ready to merge');
    await expect(cardFor(panel, /^Dark mode: fix contrast/)).toContainText('1 pending');
    await expect(cardFor(panel, /^Dark mode: fix contrast/)).toContainText('Approved');
    await expect(cardFor(panel, /^Update README badges/)).not.toContainText('passed');

    // Long titles and names stay inside the card instead of widening the panel.
    const overflow = await panel.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('labels show their GitHub color as a dot beside the name', async ({ openPanel }) => {
    const panel = await openPanel();
    const dots = await panel.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.pr-label:not(.pr-label--more)')].map((label) => {
        const hex = label.style.getPropertyValue('--label-color');
        const rgb = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
        return [getComputedStyle(label, '::before').backgroundColor, `rgb(${rgb.join(', ')})`];
      }),
    );
    expect(dots.length).toBeGreaterThan(8);
    for (const [shown, expected] of dots) expect(shown).toBe(expected);
  });

  test('opens the pull request on GitHub in a new tab', async ({ context, openPanel }) => {
    const panel = await openPanel();
    const opened = context.waitForEvent('page');
    await linkFor(panel, /^Add rate limiting/).click();
    expect((await opened).url()).toBe(`${MOCK_ORIGIN}/acme/api/pull/912`);
    expect(panel.url()).toContain('/sidepanel/index.html');
    // The title opens GitHub; it does not also expand the card.
    await expect(panel.locator('.pr-detail')).toHaveCount(0);
  });

  test('the quick filter narrows cards and counts, and says when nothing matches', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    const filter = panel.getByRole('searchbox', { name: 'Filter pull requests' });

    await filter.fill('checkout');
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine1');
    expect((await tabNames(panel)).slice(1)).toEqual(['Review0', 'Mentions0', 'Assigned0']);

    await filter.fill('label-that-does-not-exist');
    await expect(panel.getByRole('heading', { name: 'No matches' })).toBeVisible();
    await expectNoA11yViolations(panel);

    await panel.getByRole('button', { name: 'Clear filter' }).click();
    await expect(filter).toBeFocused();
    await expect(panel.getByRole('listitem')).toHaveCount(7);

    // Author, repository, label and number are searched too.
    await panel.getByRole('tab', { name: /^Review/ }).click();
    for (const [query, title] of [
      ['alice', /^Add keyboard shortcuts/],
      ['acme/api', /^Return 409/],
      ['feature', /^Add keyboard shortcuts/],
      ['#61', /^Document the new webhook/],
    ] as const) {
      await filter.fill(query);
      await expect(panel.getByRole('listitem')).toHaveCount(1);
      await expect(cardFor(panel, title)).toBeVisible();
    }
  });

  test('hides pull requests with no commit for 20 days behind a button at the end', async ({
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

  test('a new number of days in Settings applies at once, and 0 hides nothing', async ({
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
    await expect
      .poll(() => tabNames(panel))
      .toEqual(['Mine6', 'Review3', 'Mentions1', 'Assigned1']);
    await expect(panel.getByRole('button', { name: 'Show 2 hidden' })).toBeAttached();
    await expect(cardFor(panel, /^Dark mode: fix contrast/)).toHaveCount(0);

    await days('0');
    await expect
      .poll(() => tabNames(panel))
      .toEqual(['Mine8', 'Review3', 'Mentions1', 'Assigned3']);
    await expect(panel.getByRole('listitem')).toHaveCount(8);
    await expect(panel.getByRole('button', { name: /hidden/ })).toHaveCount(0);
    await expect(cardFor(panel, /^Experiment: lazy-load/)).not.toContainText('No commit');
  });

  test('hides drafts with a switch in Settings, and reveals them with the other hidden PRs', async ({
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
    await expect
      .poll(() => tabNames(panel))
      .toEqual(['Mine6', 'Review3', 'Mentions1', 'Assigned2']);
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
    await expect
      .poll(() => tabNames(panel))
      .toEqual(['Mine7', 'Review3', 'Mentions1', 'Assigned2']);
    await expect(
      panel.getByRole('list', { name: 'Created by me pull requests', exact: true }),
    ).toContainText('WIP: migrate to Postgres 16');
  });

  test('hides bot PRs with a switch, and every reason sits behind the one button', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    const [vite, eslint, moment] = [/^Bump vite/, /^Bump eslint/, /^Replace moment/];
    const why = (title: RegExp) =>
      cardFor(panel, title).getByTitle('Why it is hidden from the list');
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
    await expect
      .poll(() => tabNames(panel))
      .toEqual(['Mine7', 'Review3', 'Mentions1', 'Assigned1']);
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

  test('groups pull requests by repository with its own switch, and folds a group', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    const headers = panel.locator('.repo-group__heading');
    const header = (repo: string) =>
      panel.getByRole('button', { name: new RegExp(`^${repo} \\d`) });
    const rateLimit = /^Add rate limiting middleware/;
    await expect(headers).toHaveCount(0);

    // Its own switch in Settings, apart from the sort order.
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    const grouping = panel.getByRole('switch', { name: 'Group pull requests by repository' });
    await expect(grouping).toHaveAttribute('aria-checked', 'false');
    await expect(panel.getByLabel('Sort pull requests by')).toHaveValue('updated');
    await grouping.click();
    await expect(grouping).toHaveAttribute('aria-checked', 'true');
    await expect(panel.getByLabel('Sort pull requests by')).toHaveValue('updated');
    await panel.getByRole('button', { name: 'Back to pull requests' }).click();

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
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    // Folding: no cards, still counted, state on the button; Space does it from the keyboard.
    await header('acme/api').focus();
    await panel.keyboard.press('Space');
    await expect(header('acme/api')).toHaveAttribute('aria-expanded', 'false');
    await expect(cardFor(panel, rateLimit)).toHaveCount(0);
    // Five groups and five cards: the folded group's two are gone.
    await expect(panel.getByRole('listitem')).toHaveCount(5 + 5);
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine7');
    await expect(header('acme/api')).toBeFocused();

    // j / k go from card to card across the headers, past the folded group.
    await panel.getByRole('button', { name: /^Details for Dark mode: fix contrast/ }).focus();
    await panel.keyboard.press('j');
    await expect(
      panel.getByRole('button', { name: /^Details for Fix crash when rotating/ }),
    ).toBeFocused();
    await panel.keyboard.press('k');
    await expect(panel.getByRole('button', { name: /^Details for Dark mode/ })).toBeFocused();
    await header('acme/api').focus();
    await panel.keyboard.press('j');
    await expect(
      panel.getByRole('button', { name: /^Details for Fix crash when rotating/ }),
    ).toBeFocused();

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

  test('does not mark the cards of a folded group as seen', async ({
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

  test('marks the cards on screen as seen after 1.5 s, and the others once scrolled to', async ({
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

  test('does not mark anything seen while the panel is hidden', async ({
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

  test('looks right in light and dark, and passes axe in both', async ({
    openPanel,
    seedStorage,
    expectNoA11yViolations,
  }) => {
    // Everything seen but three, which keep their dot for the screenshot.
    const unseen = new Set([AUTHORED.checkout, AUTHORED.conflicts, AUTHORED.deps]);
    const seen = Object.fromEntries(
      authored
        .filter((node) => !unseen.has(node.id))
        .map((node) => [node.id, new Date().toISOString()]),
    );
    await seedStorage({ prLocal: { snoozed: {}, muted: {}, seen } });
    const panel = await openPanel();
    // Keep the dots: the screenshot is taken before the 1.5 s timer would clear them anyway.
    await panel.evaluate(() => {
      chrome.runtime.sendMessage = (async () => undefined) as typeof chrome.runtime.sendMessage;
    });
    await expect(panel.locator('[data-unseen="true"]')).toHaveCount(3);

    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);
    await saveScreenshot(panel, 'list-light');

    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
    await saveScreenshot(panel, 'list-dark');
  });

  test('looks right grouped by repository, in light and dark, and passes axe in both', async ({
    openPanel,
    seedStorage,
    expectNoA11yViolations,
  }) => {
    // Three dots, as in the flat list; the api group is folded to show both states.
    const unseen = new Set([AUTHORED.checkout, AUTHORED.conflicts, AUTHORED.deps]);
    const seen = Object.fromEntries(
      authored
        .filter((node) => !unseen.has(node.id))
        .map((node) => [node.id, new Date().toISOString()]),
    );
    await seedStorage({
      settings: { sections: allSections(), groupByRepo: true },
      prLocal: { snoozed: {}, muted: {}, seen },
    });
    const panel = await openPanel();
    await panel.evaluate(() => {
      chrome.runtime.sendMessage = (async () => undefined) as typeof chrome.runtime.sendMessage;
    });
    await panel.getByRole('button', { name: /^acme\/api \d/ }).click();
    // The pointer would leave the header it clicked in its hover color.
    await panel.mouse.move(0, 0);
    await expect(panel.locator('[data-unseen="true"]')).toHaveCount(3);

    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);
    await saveScreenshot(panel, 'list-grouped');

    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
    await panel.screenshot({ path: test.info().outputPath('list-grouped-dark.png') });
  });
});

test.describe('other states', () => {
  test('shows a skeleton until the first poll has produced a snapshot', async ({
    github,
    openPanel,
    seedStorage,
    signIn,
    expectNoA11yViolations,
  }) => {
    // The worker's install-time poll can start once `auth` is stored: keep any poll in flight
    // (GitHub never answers the search) so it cannot end the skeleton before the checks below.
    github.onGraphQL('ProwlSearch', () => new Promise<never>(() => undefined));
    await signIn();
    await seedStorage({
      pollState: {
        lastAttemptAt: null,
        lastSuccessAt: null,
        nextAllowedAt: null,
        consecutiveFailures: 0,
        rateLimit: null,
        lastError: null,
        inFlight: true,
      },
    });
    const panel = await openPanel();
    await expect(panel.getByRole('status', { name: 'Loading pull requests' })).toBeVisible();
    await expectNoA11yViolations(panel);
  });

  test('explains an empty section, and a list with no sections turned on', async ({
    github,
    openPanel,
    seedStorage,
    signIn,
    poll,
    expectNoA11yViolations,
  }) => {
    github.onGraphQL('ProwlSearch', (variables) => searchResponse([], variables));
    await signIn();
    await poll();
    const panel = await openPanel();
    await expect(panel.getByRole('heading', { name: 'No pull requests' })).toBeVisible();
    await expect(panel.getByText('Pull requests you open will show up here.')).toBeVisible();
    await expect(panel.getByRole('tablist')).toHaveCount(0);
    await expectNoA11yViolations(panel);

    const off = defaultSettings().sections.map((section) => ({ ...section, enabled: false }));
    await seedStorage({ settings: { sections: off } });
    await expect(panel.getByRole('heading', { name: 'No sections turned on' })).toBeVisible();
    await expectNoA11yViolations(panel);
    await panel.getByRole('button', { name: 'Open settings' }).click();
    await expect(panel.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('shows why a section failed to load next to the ones that did', async ({
    github,
    openPanel,
    seedStorage,
    signIn,
    poll,
    expectNoA11yViolations,
  }) => {
    github.onGraphQL('ProwlSearch', (variables) =>
      searchResponse(nodesFor(variables.query), variables),
    );
    const custom: Section = {
      id: 'custom-1',
      kind: 'custom',
      label: 'Stale',
      enabled: true,
      query: 'is:issue stale',
    };
    await seedStorage({ settings: { sections: [...allSections().slice(0, 1), custom] } });
    await signIn();
    await poll();

    const panel = await openPanel();
    expect(await tabNames(panel)).toEqual(['Mine7', 'StaleCould not load']);
    await panel.getByRole('tab', { name: /Stale/ }).click();
    await expect(panel.getByText(/Could not load “Stale”/)).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'No pull requests' })).toHaveCount(0);
    await expectNoA11yViolations(panel);
  });
});
