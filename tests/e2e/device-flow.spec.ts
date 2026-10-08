import type { Page, Worker } from '@playwright/test';
import { viewerNode } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { MOCK_ORIGIN, type MockGitHub } from './mock-github/server';

const OAUTH_TOKEN = 'gho_E2eOAuthAccessTokenValue0123456789abcdef';
const DEVICE = {
  device_code: 'e2e-device-secret',
  user_code: 'WDJB-MJHT',
  verification_uri: `${MOCK_ORIGIN}/login/device`,
  expires_in: 900,
  interval: 1,
};
const AVATAR = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#d97706"/></svg>',
)}`;
const viewer = viewerNode({ avatarUrl: AVATAR });

/**
 * Makes the mock play GitHub's device endpoints: the code request, and the token request, whose
 * answer `decide()` picks at the moment the extension polls. Also serves the sign-in checks.
 */
function serveDeviceFlow(github: MockGitHub, decide: () => object) {
  github.on('POST', '/login/device/code', () => ({ body: DEVICE }));
  github.on('POST', '/login/oauth/access_token', () => ({ body: decide() }));
  github.on('GET', '/login/device', () => ({ body: { page: 'device verification' } }));
  github.onGraphQL('ProwlViewer', () => ({ viewer }));
  github.on('GET', '/user', () => ({
    headers: { 'x-oauth-scopes': 'read:org, repo' },
    body: { login: viewer.login },
  }));
}

const pending = () => ({ error: 'authorization_pending' });
const startButton = (panel: Page) => panel.getByRole('button', { name: 'Continue with GitHub' });
const stored = (worker: Worker) => worker.evaluate(() => chrome.storage.local.get(null));

test.describe('sign in with the OAuth device flow', () => {
  test('shows the code, opens GitHub and signs in once the user approves', async ({
    context,
    github,
    openPanel,
    serviceWorker,
    expectNoA11yViolations,
  }) => {
    let approved = false;
    serveDeviceFlow(github, () =>
      approved
        ? { access_token: OAUTH_TOKEN, token_type: 'bearer', scope: 'read:org,repo' }
        : pending(),
    );
    const panel = await openPanel();
    await expect(startButton(panel)).toBeVisible();
    await expect(panel.getByText('or paste a token')).toBeVisible();
    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);

    const verification = context.waitForEvent('page');
    await startButton(panel).click();

    // GitHub's page opens in a tab, the panel shows what to type there.
    expect((await verification).url()).toBe(`${MOCK_ORIGIN}/login/device`);
    await panel.bringToFront();
    await expect(panel.getByText('WDJB-MJHT')).toBeVisible();
    await expect(panel.getByRole('timer')).toHaveText(/^Code expires in 1[45]:\d\d$/);
    await expect(panel.getByText(/Waiting for you to approve Prowl on GitHub/)).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Authorize Prowl on GitHub' })).toBeFocused();
    await expectNoA11yViolations(panel);
    await saveScreenshot(panel, 'device-flow');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);

    await panel.getByRole('button', { name: 'Copy code WDJB-MJHT' }).click();
    await expect(panel.getByText('Code copied')).toBeVisible();

    // Still waiting while GitHub says "pending".
    await expect
      .poll(() => github.requestsFor('/login/oauth/access_token').length)
      .toBeGreaterThan(0);
    await expect(panel.getByText('WDJB-MJHT')).toBeVisible();

    approved = true;
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(panel.getByRole('button', { name: 'Account: octocat' })).toBeVisible();
    expect(await stored(serviceWorker)).toMatchObject({
      auth: {
        method: 'oauth',
        token: OAUTH_TOKEN,
        tokenType: 'oauth',
        scopes: ['read:org', 'repo'],
        viewer,
      },
    });

    // What was sent: the public client id and the scope, then the device code, then the token.
    expect(github.requestsFor('/login/device/code')[0]?.body).toEqual({
      client_id: 'e2e-client-id',
      scope: 'repo read:org',
    });
    expect(github.requestsFor('/login/oauth/access_token')[0]?.body).toEqual({
      client_id: 'e2e-client-id',
      device_code: DEVICE.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    expect(github.requestsFor('ProwlViewer')[0]?.headers.authorization).toBe(
      `Bearer ${OAUTH_TOKEN}`,
    );
    expect(await panel.locator('body').innerText()).not.toContain(OAUTH_TOKEN);
  });

  test('tells the user when access was denied on GitHub and lets them start again', async ({
    github,
    openPanel,
    serviceWorker,
    expectNoA11yViolations,
  }) => {
    serveDeviceFlow(github, () => ({ error: 'access_denied' }));
    const panel = await openPanel();

    await startButton(panel).click();

    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('Access was denied on GitHub', { timeout: 10_000 });
    await expect(panel.getByText('WDJB-MJHT')).toHaveCount(0);
    await panel.bringToFront(); // GitHub's tab opened in front of it
    await expect(startButton(panel)).toBeFocused();
    expect(await stored(serviceWorker)).not.toHaveProperty('auth');
    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);

    // A second try works from the same screen.
    serveDeviceFlow(github, () => ({ access_token: OAUTH_TOKEN, token_type: 'bearer' }));
    await startButton(panel).click();
    await expect(panel.getByRole('main', { name: 'Pull requests' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('says so when the OAuth App cannot use the device flow', async ({ github, openPanel }) => {
    github.on('POST', '/login/device/code', () => ({ body: { error: 'device_flow_disabled' } }));
    const panel = await openPanel();

    await startButton(panel).click();

    await expect(panel.getByRole('alert')).toContainText('not available for this build of Prowl');
    await expect(panel.getByLabel('Personal access token')).toBeVisible();
  });

  test('cancel stops polling and returns to the start', async ({
    github,
    openPanel,
    serviceWorker,
  }) => {
    serveDeviceFlow(github, pending);
    const panel = await openPanel();
    await startButton(panel).click();
    await expect(panel.getByText('WDJB-MJHT')).toBeVisible();
    await expect
      .poll(() => github.requestsFor('/login/oauth/access_token').length)
      .toBeGreaterThan(0);

    await panel.getByRole('button', { name: 'Cancel' }).click();

    await expect(startButton(panel)).toBeFocused();
    await expect(panel.getByText('WDJB-MJHT')).toHaveCount(0);
    const polled = github.requestsFor('/login/oauth/access_token').length;
    await panel.waitForTimeout(2_500); // two polling intervals
    expect(github.requestsFor('/login/oauth/access_token')).toHaveLength(polled);
    expect(await stored(serviceWorker)).not.toHaveProperty('auth');
  });
});
