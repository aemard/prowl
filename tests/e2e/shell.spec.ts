import type { Page } from '@playwright/test';
import { buildPullRequest, buildSnapshotOf } from '../../src/test/panel';
import { expect, test } from './fixtures';
import { box } from './helpers/listAssertions';
import { MOCK_ORIGIN } from './mock-github/server';

const DARK_BG = 'rgb(18, 18, 21)';
const avatar = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#d97706"/></svg>',
)}`;
const auth = {
  method: 'pat',
  token: 'ghp_e2e',
  tokenType: 'classic',
  scopes: ['repo'],
  viewer: { login: 'octocat', avatarUrl: avatar, name: 'The Octocat' },
  createdAt: '2026-10-06T08:00:00.000Z',
};
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const snapshot = (fetchedAt: string) => ({
  fetchedAt,
  viewer: auth.viewer,
  pullRequests: {},
  sections: {},
});
const pollState = (inFlight: boolean) => ({
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
  rateLimit: null,
  lastError: null,
  inFlight,
});

const theme = (page: Page) =>
  page.evaluate(() => ({
    attribute: document.documentElement.dataset.theme,
    background: getComputedStyle(document.body).backgroundColor,
  }));

test.describe('signed in', () => {
  test.beforeEach(async ({ seedStorage }) => {
    await seedStorage({ auth, snapshot: snapshot(minutesAgo(2)), pollState: pollState(false) });
  });

  test('shows the shell, accessible in light and dark', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    await expect(panel.getByRole('heading', { level: 1, name: 'Prowl' })).toBeVisible();
    await expect(panel.getByText('List updated 2 min ago', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Account: octocat' })).toBeVisible();
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();

    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
  });

  test('centers unseen dots beside the first row without moving card content', async ({
    openPanel,
    seedStorage,
  }) => {
    await seedStorage({
      snapshot: buildSnapshotOf({
        authored: [
          buildPullRequest(),
          buildPullRequest({ number: 2, title: 'A long '.repeat(30) }),
        ],
      }),
    });
    const panel = await openPanel();
    await panel.clock.install();
    await panel.clock.pauseAt(new Date());
    for (const groupByRepo of [false, true]) {
      for (const theme of ['light', 'dark']) {
        await seedStorage({ settings: { groupByRepo, theme } });
        for (const width of [320, 400, 600]) {
          await panel.setViewportSize({ width, height: 760 });
          const cards = panel.locator('.pr-card__summary');
          await expect(cards).toHaveCount(2);
          for (const card of await cards.all()) {
            const dot = card.getByTitle('Unseen changes');
            await expect(dot).toHaveCount(1);
            const before = await box(card.locator('.pr-card__title'));
            const row = await box(card.locator('.pr-card__head'));
            const avatar = await box(card.locator('.ui-avatar'));
            const bounds = await box(card);
            const mark = await box(dot);
            expect(mark.y + mark.height / 2).toBeCloseTo(row.y + row.height / 2, 1);
            expect(mark.y + mark.height / 2).toBeCloseTo(avatar.y + avatar.height / 2, 1);
            expect(mark.x).toBeGreaterThan(bounds.x);
            expect(mark.x + mark.width).toBeLessThan(avatar.x);
            await dot.evaluate((element) => {
              element.remove();
            });
            expect(await box(card.locator('.pr-card__title'))).toEqual(before);
          }
          // Restore the indicators after checking that removing them cannot change layout.
          await panel.reload();
        }
      }
    }
  });

  test('applies the theme from settings, live', async ({ openPanel, seedStorage }) => {
    await seedStorage({ settings: { theme: 'dark' } });
    const panel = await openPanel();
    await panel.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => theme(panel)).toEqual({ attribute: 'dark', background: DARK_BG });

    await seedStorage({ settings: { theme: 'light' } });
    await expect.poll(() => theme(panel).then((t) => t.attribute)).toBe('light');
    await seedStorage({ settings: { theme: 'system' } });
    await expect.poll(() => theme(panel).then((t) => t.attribute)).toBeUndefined();
  });

  test('keeps in sync with what the service worker stores', async ({ openPanel, seedStorage }) => {
    const panel = await openPanel();
    await seedStorage({ snapshot: snapshot(new Date().toISOString()) });
    await expect(panel.getByText('List updated just now')).toBeVisible();
    await seedStorage({ snapshot: snapshot(minutesAgo(5)) });
    await expect(panel.getByText('List updated 5 min ago')).toBeVisible();

    await seedStorage({ pollState: pollState(true) });
    await expect(panel.getByRole('button', { name: 'Refresh' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await seedStorage({ pollState: pollState(false) });
    await expect(panel.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute('aria-busy');
  });

  test('refresh asks the service worker for a forced poll', async ({
    openPanel,
    serviceWorker,
  }) => {
    await serviceWorker.evaluate(() => {
      const received: unknown[] = [];
      Object.assign(globalThis, { received });
      chrome.runtime.onMessage.addListener((message) => {
        // Visibility hints may accompany rendering; only a poll starts a refresh.
        if (message?.type === 'poll') received.push(message);
      });
    });
    const panel = await openPanel();
    await panel.getByRole('button', { name: 'Refresh' }).click();
    await expect
      .poll(() => serviceWorker.evaluate(() => (globalThis as { received?: unknown[] }).received))
      .toEqual([{ type: 'poll', force: true }]);
  });

  test('moves between the list and settings, and back to onboarding on sign-out', async ({
    openPanel,
    seedStorage,
    serviceWorker,
  }) => {
    const panel = await openPanel();
    await panel.getByRole('button', { name: 'Settings' }).click();
    await expect(panel).toHaveURL(/#\/settings$/);
    await expect(panel.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(panel.getByRole('main', { name: 'Settings' })).toBeFocused();

    await panel.getByRole('button', { name: 'Back to pull requests' }).click();
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeFocused();

    await serviceWorker.evaluate(() => chrome.storage.local.remove('auth'));
    await expect(panel.getByRole('heading', { name: 'See your pull requests here' })).toBeVisible();
    await seedStorage({ auth });
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  });

  test('opens the GitHub profile from the account menu', async ({
    context,
    openPanel,
    seedStorage,
  }) => {
    await seedStorage({ snapshot: buildSnapshotOf({ authored: [buildPullRequest()] }) });
    const panel = await openPanel();
    await expect(panel.getByRole('searchbox')).toBeVisible();
    await panel.getByRole('button', { name: 'Account: octocat' }).click();
    const profile = panel.getByRole('menuitem', { name: 'View GitHub profile' });
    // Poll through the menu entrance animation and test the overlapping first row.
    await expect
      .poll(() =>
        profile.evaluate((item) => {
          const box = item.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit?.closest('[role="menuitem"]') === item;
        }),
      )
      .toBe(true);
    const opened = context.waitForEvent('page');
    await panel.getByRole('menuitem', { name: 'View GitHub profile' }).click();
    expect((await opened).url()).toBe(`${MOCK_ORIGIN}/octocat`);
  });
});
