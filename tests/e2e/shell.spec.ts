import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
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
    await expect(panel.getByText('Updated 2 min ago')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Account: octocat' })).toBeVisible();
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();

    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
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
    await expect(panel.getByText('Updated just now')).toBeVisible();
    await seedStorage({ snapshot: snapshot(minutesAgo(5)) });
    await expect(panel.getByText('Updated 5 min ago')).toBeVisible();

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
        received.push(message);
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
    await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toBeVisible();
    await seedStorage({ auth });
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  });

  test('opens the GitHub profile from the account menu', async ({ context, openPanel }) => {
    const panel = await openPanel();
    await panel.getByRole('button', { name: 'Account: octocat' }).click();
    const opened = context.waitForEvent('page');
    await panel.getByRole('menuitem', { name: 'View GitHub profile' }).click();
    expect((await opened).url()).toBe(`${MOCK_ORIGIN}/octocat`);
  });
});
