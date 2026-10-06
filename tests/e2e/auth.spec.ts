import type { Page, Worker } from '@playwright/test';
import { viewerNode } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { MOCK_ORIGIN, type MockGitHub } from './mock-github/server';

const CLASSIC = 'ghp_E2eClassicTokenValue0123456789abcdefABCD';
const FINE_GRAINED = 'github_pat_11E2E0123456789abcdef_FineGrainedTokenValue0123456789abcdef';
const AVATAR = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#d97706"/></svg>',
)}`;
const viewer = viewerNode({ avatarUrl: AVATAR });

/** Makes the mock answer the sign-in checks: the viewer query and `GET /user` with scopes. */
function serveAccount(github: MockGitHub, scopes: string | null = 'repo, read:org') {
  github.onGraphQL('ProwlViewer', () => ({ viewer }));
  const headers: Record<string, string> = scopes === null ? {} : { 'x-oauth-scopes': scopes };
  github.on('GET', '/user', () => ({ headers, body: { login: viewer.login } }));
}

/** Makes the mock refuse every token, as GitHub does for a revoked or mistyped one. */
function rejectTokens(github: MockGitHub) {
  const refused = { status: 401, body: { message: `Bad credentials ${CLASSIC}` } };
  github.onGraphQL('ProwlViewer', () => refused);
  github.on('GET', '/user', () => refused);
}

/** Collects what the side panel sends to the service worker. */
async function recordMessages(worker: Worker) {
  await worker.evaluate(() => {
    const received: unknown[] = [];
    Object.assign(globalThis, { received });
    chrome.runtime.onMessage.addListener((message) => {
      received.push(message);
    });
  });
  return () => worker.evaluate(() => (globalThis as unknown as { received: unknown[] }).received);
}

const stored = (worker: Worker) => worker.evaluate(() => chrome.storage.local.get(null));

const tokenField = (panel: Page) => panel.getByLabel('Personal access token');

async function signInWith(panel: Page, token: string) {
  await tokenField(panel).fill(token);
  await panel.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('onboarding', () => {
  test('explains both token types, accessible in light and dark', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect(tokenField(panel)).toHaveAttribute('type', 'password');
    await expect(panel.getByRole('heading', { name: 'Classic token' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Fine-grained token' })).toBeVisible();
    await expect(panel.getByText(/does not offer the Checks permission/)).toBeVisible();

    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);
    await saveScreenshot(panel, 'onboarding');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
  });

  test('links to the token creation pages with the scopes filled in', async ({
    context,
    openPanel,
  }) => {
    const panel = await openPanel();

    const classic = context.waitForEvent('page');
    await panel.getByRole('link', { name: 'Create a classic token' }).click();
    expect((await classic).url()).toBe(
      `${MOCK_ORIGIN}/settings/tokens/new?scopes=repo&description=Prowl`,
    );

    const fineGrained = context.waitForEvent('page');
    await panel.getByRole('link', { name: 'Create a fine-grained token' }).click();
    const url = new URL((await fineGrained).url());
    expect(url.pathname).toBe('/settings/personal-access-tokens/new');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      pull_requests: 'write',
      contents: 'write',
      actions: 'write',
      statuses: 'read',
    });
  });
});

test.describe('sign in', () => {
  test('validates a classic token, stores it, polls and shows the list', async ({
    github,
    openPanel,
    serviceWorker,
    expectNoA11yViolations,
  }) => {
    serveAccount(github);
    const messages = await recordMessages(serviceWorker);
    const panel = await openPanel();

    await signInWith(panel, `  ${CLASSIC}  `);

    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Account: octocat' })).toBeVisible();
    await expect(panel).toHaveURL(/#\/$/);
    expect(await stored(serviceWorker)).toMatchObject({
      auth: {
        method: 'pat',
        token: CLASSIC,
        tokenType: 'classic',
        scopes: ['repo', 'read:org'],
        viewer,
      },
    });
    await expect.poll(messages).toContainEqual({ type: 'poll', force: true });

    for (const request of [github.requestsFor('ProwlViewer')[0], github.requestsFor('/user')[0]]) {
      expect(request?.headers.authorization).toBe(`Bearer ${CLASSIC}`);
    }
    expect(await panel.locator('body').innerText()).not.toContain(CLASSIC);
    await expectNoA11yViolations(panel);
  });

  test('warns when a classic token has no repo scope', async ({ github, openPanel }) => {
    serveAccount(github, 'read:user');
    const panel = await openPanel();

    await signInWith(panel, CLASSIC);

    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();
    await expect(
      panel.getByText(/Signed in as octocat\. This token has no repo scope/),
    ).toBeVisible();
  });

  test('accepts a fine-grained token and warns about CI status', async ({
    github,
    openPanel,
    serviceWorker,
  }) => {
    serveAccount(github, null);
    const panel = await openPanel();

    await signInWith(panel, FINE_GRAINED);

    await expect(
      panel.getByText(/Signed in as octocat\. GitHub does not offer the Checks permission/),
    ).toBeVisible();
    expect(await stored(serviceWorker)).toMatchObject({
      auth: { token: FINE_GRAINED, tokenType: 'fine_grained', scopes: [] },
    });
  });

  test('shows an inline error for an invalid token and stays signed out', async ({
    github,
    openPanel,
    serviceWorker,
    expectNoA11yViolations,
  }) => {
    rejectTokens(github);
    const messages = await recordMessages(serviceWorker);
    const panel = await openPanel();

    await signInWith(panel, CLASSIC);

    const error = panel.getByText(/GitHub rejected this token/);
    await expect(error).toBeVisible();
    await expect(tokenField(panel)).toBeFocused();
    await expect(tokenField(panel)).toHaveAttribute('aria-invalid', 'true');
    await expect(panel.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-busy');
    expect(await panel.locator('body').innerText()).not.toContain(CLASSIC);
    expect(await stored(serviceWorker)).not.toHaveProperty('auth');
    expect(await messages()).toEqual([]);
    await expectNoA11yViolations(panel);

    // Fixing the token works from the same screen.
    serveAccount(github);
    await signInWith(panel, CLASSIC);
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  });

  test('asks for a token before calling GitHub, and refuses text that is not one', async ({
    github,
    openPanel,
  }) => {
    const panel = await openPanel();

    await panel.getByRole('button', { name: 'Sign in' }).click();
    await expect(panel.getByText('Paste a token to sign in.')).toBeVisible();

    await signInWith(panel, 'Bearer ghp_with spaces');
    await expect(panel.getByText(/does not look like a GitHub token/)).toBeVisible();
    expect(github.requests).toEqual([]);
  });
});

test.describe('sign out', () => {
  const auth = {
    method: 'pat',
    token: CLASSIC,
    tokenType: 'classic',
    scopes: ['repo'],
    viewer,
    createdAt: '2026-10-06T08:00:00.000Z',
  };
  const snapshot = { fetchedAt: new Date().toISOString(), viewer, pullRequests: {}, sections: {} };
  const pollState = {
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextAllowedAt: null,
    consecutiveFailures: 0,
    rateLimit: null,
    lastError: null,
    inFlight: false,
  };

  test('confirms first, then forgets the account and returns to onboarding', async ({
    openPanel,
    seedStorage,
    serviceWorker,
    expectNoA11yViolations,
  }) => {
    await seedStorage({ auth, snapshot, pollState, settings: { theme: 'system' } });
    const messages = await recordMessages(serviceWorker);
    const panel = await openPanel();

    // Cancelling changes nothing.
    await panel.getByRole('button', { name: 'Account: octocat' }).click();
    await panel.getByRole('menuitem', { name: 'Sign out' }).click();
    const dialog = panel.getByRole('dialog', { name: 'Sign out?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expectNoA11yViolations(panel);
    await panel.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await stored(serviceWorker)).toHaveProperty('auth');

    // Confirming does.
    await panel.getByRole('button', { name: 'Account: octocat' }).click();
    await panel.getByRole('menuitem', { name: 'Sign out' }).click();
    await panel.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();

    await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect(panel.getByRole('dialog')).toHaveCount(0);
    const left = await stored(serviceWorker);
    expect(left).not.toHaveProperty('auth');
    expect(left).not.toHaveProperty('snapshot');
    expect(left).not.toHaveProperty('pollState');
    expect(left).toHaveProperty('settings');
    expect(JSON.stringify(left)).not.toContain(CLASSIC);
    await expect.poll(messages).toContainEqual({ type: 'signedOut' });
    await expectNoA11yViolations(panel);
  });
});
