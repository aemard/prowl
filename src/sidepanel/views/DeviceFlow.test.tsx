import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewerNode } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import { fakeChrome } from '../../test/chrome';
import { toasts } from '../components/ui/Toast';
import { DeviceFlow } from './DeviceFlow';

const TOKEN = 'gho_OAuthAccessTokenValue0123456789abcdef';
const DEVICE_CODE_BODY = {
  device_code: 'device-secret',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 1,
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
});

afterEach(() => {
  vi.useRealTimers();
  toasts.value = [];
  location.hash = '';
});

interface GitHubStub {
  /** What `/login/oauth/access_token` answers, in turn (the last repeats). */
  polls?: object[];
  /** Answer of `/login/device/code`. */
  code?: Response;
  scopes?: string;
  /** Answer of the sign-in checks. */
  account?: Response;
}

/** Stubs github.com's device endpoints and the API calls that check the new token. */
function stubGitHub({
  polls = [{ access_token: TOKEN }],
  code,
  scopes = 'repo, read:org',
  account,
}: GitHubStub = {}) {
  let poll = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/login/device/code')) return code ?? jsonResponse(DEVICE_CODE_BODY);
    if (url.endsWith('/login/oauth/access_token')) {
      return jsonResponse(polls[Math.min(poll++, polls.length - 1)]);
    }
    if (account) return account.clone();
    return url.endsWith('/graphql')
      ? jsonResponse({ data: { viewer: viewerNode() } })
      : jsonResponse({ login: 'octocat' }, { headers: { 'x-oauth-scopes': scopes } });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const urls = (fetch: ReturnType<typeof stubGitHub>) => fetch.mock.calls.map(([url]) => String(url));
const start = () => screen.getByRole('button', { name: 'Continue with GitHub' });

/** Clicks the start button and lets the permission and code requests settle. */
async function begin() {
  await act(async () => {
    fireEvent.click(start());
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('DeviceFlow', () => {
  it('asks to be allowed on github.com, shows the code, opens GitHub and keeps the code on screen', async () => {
    const request = vi.spyOn(chrome.permissions, 'request');
    stubGitHub({ polls: [{ error: 'authorization_pending' }] });
    render(<DeviceFlow />);
    expect(screen.getByText(/Approve Prowl on github\.com with a one-time code/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(start());
      // Still inside the click: the permission request has to have been made by now.
      expect(request).toHaveBeenCalledWith({ origins: ['https://github.com/*'] });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('WDJB-MJHT')).toBeTruthy();
    expect(screen.getByText('Enter this code on GitHub to finish signing in.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for you to approve/);
    expect(fakeChrome().__state.createdTabs).toEqual([{ url: 'https://github.com/login/device' }]);
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'Authorize Prowl on GitHub' }),
    );
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull();
  });

  it('counts down to the end of the code', async () => {
    stubGitHub({ polls: [{ error: 'authorization_pending' }] });
    render(<DeviceFlow />);
    await begin();
    expect(screen.getByRole('timer').textContent).toBe('Code expires in 15:00');

    await advance(2_000);
    expect(screen.getByRole('timer').textContent).toBe('Code expires in 14:58');

    await advance(897_000);
    expect(screen.getByRole('timer').textContent).toBe('Code expires in 0:01');

    await advance(2_000);
    expect(screen.getByRole('alert').textContent).toMatch(/The code expired/);
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('opens the verification page again on request', async () => {
    stubGitHub({ polls: [{ error: 'authorization_pending' }] });
    render(<DeviceFlow />);
    await begin();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }));
    });

    expect(fakeChrome().__state.createdTabs).toHaveLength(2);
  });

  it('copies the code', async () => {
    stubGitHub({ polls: [{ error: 'authorization_pending' }] });
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<DeviceFlow />);
    await begin();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code WDJB-MJHT' }));
    });

    expect(write).toHaveBeenCalledWith('WDJB-MJHT');
    expect(toasts.value.map((toast) => toast.message)).toEqual(['Code copied']);
  });

  it('says so when the clipboard is not available', async () => {
    stubGitHub({ polls: [{ error: 'authorization_pending' }] });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<DeviceFlow />);
    await begin();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code WDJB-MJHT' }));
    });

    expect(toasts.value[0]).toMatchObject({ tone: 'danger' });
    expect(toasts.value[0]?.message).toMatch(/Could not copy/);
  });

  it('signs in once the user approves: stores an oauth account, polls and shows the list', async () => {
    const fetch = stubGitHub({
      polls: [{ error: 'authorization_pending' }, { access_token: TOKEN }],
    });
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    location.hash = '#/onboarding';
    render(<DeviceFlow />);
    await begin();

    await advance(1_000);
    expect(location.hash).toBe('#/onboarding');
    await advance(1_000);

    expect(location.hash).toBe('#/');
    const { auth } = await chrome.storage.local.get('auth');
    expect(auth).toMatchObject({
      method: 'oauth',
      token: TOKEN,
      tokenType: 'oauth',
      scopes: ['repo', 'read:org'],
      viewer: viewerNode(),
    });
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
    expect(toasts.value).toEqual([]);
    expect(urls(fetch).filter((url) => url.endsWith('/access_token'))).toHaveLength(2);
  });

  it('signs in with a warning when GitHub granted less than the repo scope', async () => {
    stubGitHub({ scopes: 'read:user' });
    render(<DeviceFlow />);
    await begin();
    await advance(1_000);

    expect(toasts.value[0]?.message).toMatch(
      /^Signed in as octocat\. This token has no repo scope/,
    );
    expect((await chrome.storage.local.get('auth')).auth).toBeDefined();
  });

  it('explains why access to github.com is needed when it is not granted', async () => {
    vi.spyOn(fakeChrome().permissions, 'request').mockResolvedValue(false);
    const fetch = stubGitHub();
    render(<DeviceFlow />);

    await begin();

    expect(screen.getByRole('alert').textContent).toMatch(
      /needs access to github\.com to sign you in from the browser.*paste a token/,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(start().getAttribute('aria-busy')).toBeNull();
  });

  it('shows the denial, goes back to the start button and lets the user try again', async () => {
    stubGitHub({ polls: [{ error: 'access_denied' }] });
    render(<DeviceFlow />);
    await begin();
    await advance(1_000);

    expect(screen.getByRole('alert').textContent).toMatch(/Access was denied on GitHub/);
    expect(screen.queryByText('WDJB-MJHT')).toBeNull();
    expect(document.activeElement).toBe(start());
    expect((await chrome.storage.local.get('auth')).auth).toBeUndefined();

    stubGitHub();
    await begin();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('WDJB-MJHT')).toBeTruthy();
  });

  it('reports an expired code and an unreachable GitHub', async () => {
    stubGitHub({ polls: [{ error: 'expired_token' }] });
    const { unmount } = render(<DeviceFlow />);
    await begin();
    await advance(1_000);
    expect(screen.getByRole('alert').textContent).toMatch(/The code expired/);
    unmount();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    render(<DeviceFlow />);
    await begin();
    expect(screen.getByRole('alert').textContent).toMatch(/Could not reach GitHub/);
  });

  it('shows why the token was refused when GitHub rejects what it just issued', async () => {
    stubGitHub({ account: jsonResponse({ message: 'Bad credentials' }, { status: 401 }) });
    render(<DeviceFlow />);
    await begin();
    await advance(1_000);

    expect(screen.getByRole('alert').textContent).toMatch(/GitHub rejected this token/);
    expect((await chrome.storage.local.get('auth')).auth).toBeUndefined();
  });

  it('cancels: back to the start button, no more polling', async () => {
    const fetch = stubGitHub({ polls: [{ error: 'authorization_pending' }] });
    render(<DeviceFlow />);
    await begin();
    await advance(1_000);
    const polled = urls(fetch).length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(screen.queryByText('WDJB-MJHT')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(start());
    await advance(10_000);
    expect(urls(fetch)).toHaveLength(polled);
  });

  it('does not sign in when cancelled while GitHub checks the token', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = stubGitHub();
    fetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/login/device/code')) return jsonResponse(DEVICE_CODE_BODY);
      if (url.endsWith('/login/oauth/access_token')) return jsonResponse({ access_token: TOKEN });
      await gate;
      return url.endsWith('/graphql')
        ? jsonResponse({ data: { viewer: viewerNode() } })
        : jsonResponse({}, { headers: { 'x-oauth-scopes': 'repo' } });
    });
    render(<DeviceFlow />);
    await begin();
    await advance(1_000);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      release();
    });
    await advance(0);

    expect((await chrome.storage.local.get('auth')).auth).toBeUndefined();
    expect(location.hash).not.toBe('#/');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops when the view goes away', async () => {
    const fetch = stubGitHub({ polls: [{ error: 'authorization_pending' }] });
    const { unmount } = render(<DeviceFlow />);
    await begin();
    const requests = urls(fetch).length;

    unmount();
    await advance(10_000);

    expect(urls(fetch)).toHaveLength(requests);
  });

  it('ignores a second click while the first is starting', async () => {
    const request = vi.spyOn(chrome.permissions, 'request');
    stubGitHub();
    render(<DeviceFlow />);

    await act(async () => {
      fireEvent.click(start());
      fireEvent.click(start());
    });

    expect(request).toHaveBeenCalledTimes(1);
  });
});
