import type { Locator, Page, Worker } from '@playwright/test';
import type { PrLocalState, Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { prId, searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { authored, nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

const allSections = (): Section[] =>
  defaultSettings().sections.map((section) => ({ ...section, enabled: true }));

/** Ids of the authored PRs, newest activity first (the default sort). */
const AUTHORED = {
  checkout: prId(2481, 'acme/web'),
  rateLimit: prId(912, 'acme/api'),
  draft: prId(905, 'acme/api'),
  conflicts: prId(377, 'acme/mobile'),
  badges: prId(58, 'octo/docs'),
  deps: prId(1042, 'northwind-engineering/internal-platform-services-monorepo'),
  contrast: prId(2470, 'acme/web'),
};

const tabNames = (panel: Page) => panel.getByRole('tab').allTextContents();
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

  test('shows the sections as tabs with counts and switches between them', async ({
    openPanel,
  }) => {
    const panel = await openPanel();
    await expect(panel.getByRole('tab')).toHaveCount(4);
    expect(await tabNames(panel)).toEqual([
      'Created by me7',
      'Review requested3',
      'Mentioned1',
      'Assigned to me1',
    ]);
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Created by me7');
    await expect(panel.getByRole('listitem')).toHaveCount(7);

    await panel.getByRole('tab', { name: /Review requested/ }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await expect(cardFor(panel, /^Add keyboard shortcuts/)).toBeVisible();

    // Arrow keys move between tabs, like any tab list.
    await panel.getByRole('tab', { selected: true }).press('ArrowRight');
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mentioned1');
    await expect(cardFor(panel, /^Spike: edge-render/)).toBeVisible();
  });

  test('four sections scroll sideways with an edge cue, and every tab is reachable by keyboard', async ({
    openPanel,
  }) => {
    const panel = await openPanel();
    const tablist = panel.getByRole('tablist');
    const overflow = () => tablist.evaluate((el) => el.scrollWidth - el.clientWidth);
    const inView = (tab: Locator) =>
      tab.evaluate((el) => {
        const [t, l] = [el, el.closest('[role="tablist"]')].map((e) => e?.getBoundingClientRect());
        return !!t && !!l && t.left >= l.left && t.right <= l.right;
      });

    expect(await overflow()).toBeGreaterThan(0);
    // A chevron at the edge says there are more tabs that way.
    const more = (side: string) => panel.locator(`.section-tabs__more[data-side="${side}"]`);
    await expect(more('end')).toBeVisible();
    await expect(more('start')).toHaveCount(0);

    await panel.getByRole('tab', { selected: true }).press('End');
    const last = panel.getByRole('tab', { name: /Assigned to me/ });
    await expect(last).toBeFocused();
    await expect.poll(() => inView(last)).toBe(true);
    expect(await tablist.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(more('end')).toHaveCount(0);
    await expect(more('start')).toBeVisible();

    await last.press('Home');
    await expect(panel.getByRole('tab', { name: /Created by me/ })).toBeFocused();
    await expect.poll(() => tablist.evaluate((el) => el.scrollLeft)).toBe(0);
    await expect(more('end')).toBeVisible();
    await panel.screenshot({ path: test.info().outputPath('tabs-four.png') });
  });

  test('three sections fit the panel without scrolling', async ({ openPanel, seedStorage }) => {
    const sections = allSections().map((section) => ({
      ...section,
      enabled: section.id !== 'assigned',
    }));
    await seedStorage({ settings: { sections } });
    const panel = await openPanel();
    const tablist = panel.getByRole('tablist');
    await expect(panel.getByRole('tab')).toHaveCount(3);
    expect(await tablist.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await panel.screenshot({ path: test.info().outputPath('tabs-three.png') });
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
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Created by me1');
    expect((await tabNames(panel)).slice(1)).toEqual([
      'Review requested0',
      'Mentioned0',
      'Assigned to me0',
    ]);

    await filter.fill('label-that-does-not-exist');
    await expect(panel.getByRole('heading', { name: 'No matches' })).toBeVisible();
    await expectNoA11yViolations(panel);

    await panel.getByRole('button', { name: 'Clear filter' }).click();
    await expect(filter).toBeFocused();
    await expect(panel.getByRole('listitem')).toHaveCount(7);

    // Author, repository, label and number are searched too.
    await panel.getByRole('tab', { name: /Review requested/ }).click();
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
});

test.describe('other states', () => {
  test('shows a skeleton until the first poll has produced a snapshot', async ({
    openPanel,
    seedStorage,
    signIn,
    expectNoA11yViolations,
  }) => {
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
    expect(await tabNames(panel)).toEqual(['Created by me7', 'StaleCould not load']);
    await panel.getByRole('tab', { name: /Stale/ }).click();
    await expect(panel.getByText(/Could not load “Stale”/)).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'No pull requests' })).toHaveCount(0);
    await expectNoA11yViolations(panel);
  });
});
