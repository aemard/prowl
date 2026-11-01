import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import {
  AUTHORED,
  allSections,
  barBottom,
  barTop,
  box,
  cardFor,
  linkFor,
  tabNames,
} from './helpers/listAssertions';
import { authored, nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

test.describe('with a rich set of pull requests', () => {
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
    expect(await barBottom(panel)).toBe(748);
    await panel.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => barBottom(panel)).toBe(748);
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
    await seedStorage({ settings: { groupByRepo: false, sections: [...allSections(), long] } });
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
      settings: {
        groupByRepo: false,
        sections: [...allSections(), long, custom('custom-2', 'Docs')],
      },
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

    const cards = panel.locator('.pr-list .pr-card');
    const count = await cards.count();
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
    // The snoozed card leaves the list once storage tells the panel. Until it has, the last toggle
    // below is still its own: removed late, the next one (focused below to start from) becomes
    // the last, and focusing it again scrolls nothing.
    await expect(cards).toHaveCount(count - 1);

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
    await seedStorage({ settings: { groupByRepo: false, sections: off } });
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
    await seedStorage({
      settings: { groupByRepo: false, sections: [...allSections().slice(0, 1), custom] },
    });
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
