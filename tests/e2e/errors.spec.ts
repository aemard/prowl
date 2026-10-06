import type { Page } from '@playwright/test';
import { prNode, searchResponse, viewerNode } from '../fixtures/github';
import { rateLimitHeaders } from '../fixtures/http';
import { expect, saveScreenshot, test } from './fixtures';
import { MOCK_ORIGIN, type MockGitHub, type MockResponse } from './mock-github/server';

const TOKEN = 'ghp_E2eNewClassicTokenValue0123456789abcdefABCD';
const pullRequest = {
  ...prNode({ repository: 'acme/web', number: 12, title: 'Cache the repository list' }),
  url: `${MOCK_ORIGIN}/acme/web/pull/12`,
};

/** Serves one pull request until `failWith(response)` makes every search fail; `null` heals it. */
function serveList(github: MockGitHub) {
  let failure: MockResponse | null = null;
  github.onGraphQL(
    'ProwlSearch',
    (variables) => failure ?? searchResponse([pullRequest], variables),
  );
  return (response: MockResponse | null) => {
    failure = response;
  };
}

/** What `signIn` of a new token needs from GitHub. */
function serveAccount(github: MockGitHub) {
  github.onGraphQL('ProwlViewer', () => ({ viewer: viewerNode() }));
  github.on('GET', '/user', () => ({
    headers: { 'x-oauth-scopes': 'repo' },
    body: { login: 'octocat' },
  }));
}

const card = (panel: Page) => panel.getByRole('link', { name: /Cache the repository list/ });
const clockOf = (panel: Page, ms: number) =>
  panel.evaluate(
    (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    ms,
  );

let failWith: (response: MockResponse | null) => void;

test.beforeEach(async ({ github, signIn, poll }) => {
  serveAccount(github);
  failWith = serveList(github);
  await signIn();
  await poll();
});

test('a rejected token: banner with a way back in, the list stays readable', async ({
  openPanel,
  poll,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  await expect(card(panel)).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);

  failWith({ status: 401, body: { message: 'Bad credentials' } });
  await poll();

  const alert = panel.getByRole('alert');
  await expect(alert).toContainText('Your GitHub token was revoked or expired');
  await expect(card(panel)).toBeVisible();
  await panel.emulateMedia({ colorScheme: 'light' });
  await expectNoA11yViolations(panel);
  await saveScreenshot(panel, 'banner-token');
  await panel.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(panel);
  await panel.emulateMedia({ colorScheme: 'light' });

  // Re-authenticating keeps the settings and the snapshot, and the banner goes with the problem.
  await serviceWorker.evaluate(() => chrome.storage.local.set({ settings: { maxPerSection: 30 } }));
  failWith(null);
  await panel.getByRole('button', { name: 'Re-authenticate' }).click();
  await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByLabel('Personal access token').fill(TOKEN);
  await panel.getByRole('button', { name: 'Sign in' }).click();

  await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  await expect(card(panel)).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  const { settings, auth, pollState } = await serviceWorker.evaluate(() =>
    chrome.storage.local.get(['settings', 'auth', 'pollState']),
  );
  expect(settings).toMatchObject({ maxPerSection: 30 });
  expect(auth).toMatchObject({ token: TOKEN });
  expect(pollState).toMatchObject({ lastError: null });
});

test('a rejected token before the first list loads says so instead of a skeleton', async ({
  openPanel,
  serviceWorker,
  poll,
}) => {
  await serviceWorker.evaluate(() => chrome.storage.local.remove(['snapshot', 'pollState']));
  failWith({ status: 401, body: { message: 'Bad credentials' } });
  await poll();

  const panel = await openPanel();
  await expect(panel.getByRole('alert')).toContainText('token was revoked or expired');
  await expect(panel.getByRole('heading', { name: 'Could not load pull requests' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Re-authenticate' })).toBeVisible();
});

test('rate limited: banner with the reset time, no retry, the list stays readable', async ({
  openPanel,
  poll,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  await expect(card(panel)).toBeVisible();

  const reset = Math.floor(Date.now() / 1000) + 25 * 60;
  failWith({
    status: 403,
    headers: rateLimitHeaders({ remaining: 0, reset }),
    body: { message: 'API rate limit exceeded for user ID 1.' },
  });
  await poll();

  const status = panel.getByRole('status').filter({ hasText: 'Rate limited until' });
  await expect(status).toContainText(`Rate limited until ${await clockOf(panel, reset * 1000)}`);
  await expect(panel.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(card(panel)).toBeVisible();
  await panel.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(panel);
  await saveScreenshot(panel, 'banner-rate-limit');
});

test('a GitHub error: banner with its message, and Retry now recovers', async ({
  github,
  openPanel,
  poll,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  await expect(card(panel)).toBeVisible();

  failWith({ status: 502, body: { message: 'Bad gateway' } });
  await poll();

  const status = panel.getByRole('status').filter({ hasText: 'GitHub error' });
  await expect(status).toContainText(/GitHub error — retrying in [34] min/);
  await expect(status).toContainText('Bad gateway');
  await expect(card(panel)).toBeVisible();
  await expectNoA11yViolations(panel);

  failWith(null);
  const searches = github.requestsFor('ProwlSearch').length;
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(status).toHaveCount(0);
  expect(github.requestsFor('ProwlSearch').length).toBeGreaterThan(searches);
  await expect(card(panel)).toBeVisible();
});

test('offline: banner counts down to the retry, the list stays readable', async ({
  github,
  openPanel,
  poll,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  await expect(card(panel)).toBeVisible();

  // Stopping the mock closes its port: the next request is refused, as with no connection.
  await github.stop();
  try {
    await poll();
  } finally {
    await github.start();
  }

  const status = panel.getByRole('status').filter({ hasText: 'Offline' });
  await expect(status).toContainText(/Offline — retrying in [34] min/);
  await expect(status).toContainText('Could not reach GitHub.');
  await expect(card(panel)).toBeVisible();
  await expectNoA11yViolations(panel);

  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(status).toHaveCount(0);
  await expect(card(panel)).toBeVisible();
});

test('data that stopped updating without an error is marked with its age', async ({
  openPanel,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  await expect(card(panel)).toBeVisible();
  await expect(panel.getByRole('status')).toHaveCount(0);

  await serviceWorker.evaluate(async () => {
    const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const { snapshot, pollState } = (await chrome.storage.local.get(['snapshot', 'pollState'])) as {
      snapshot: object;
      pollState: object;
    };
    await chrome.storage.local.set({
      snapshot: { ...snapshot, fetchedAt: old },
      pollState: { ...pollState, lastSuccessAt: old },
    });
  });

  const status = panel.getByRole('status').filter({ hasText: 'out of date' });
  await expect(status).toBeVisible();
  await expect(panel.getByText('Last updated 3 h ago.')).toBeVisible();
  await expect(card(panel)).toBeVisible();
  await expectNoA11yViolations(panel);

  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect(status).toHaveCount(0);
});
