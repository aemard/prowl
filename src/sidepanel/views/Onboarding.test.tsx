import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewerNode } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import { env } from '../../lib/env';
import { AUTH_DOCS_URL } from '../../lib/github/auth/deviceFlow';
import { TOKEN_URLS } from '../../lib/github/auth/pat';
import { fakeChrome } from '../../test/chrome';
import { toasts } from '../components/ui/Toast';
import { OnboardingView } from './Onboarding';

const TOKEN = 'ghp_ClassicTokenValue0123456789abcdefABCD';

afterEach(() => {
  toasts.value = [];
  location.hash = '';
});

/** Stubs GitHub: the viewer query and `GET /user` with the given scopes header. */
function stubGitHub(scopes = 'repo') {
  const fetch = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/graphql')
      ? jsonResponse({ data: { viewer: viewerNode() } })
      : jsonResponse({ login: 'octocat' }, { headers: { 'x-oauth-scopes': scopes } }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const field = () => screen.getByLabelText('Personal access token') as HTMLInputElement;
const submit = async (token: string) => {
  fireEvent.input(field(), { target: { value: token } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  });
};

describe('OnboardingView', () => {
  it('offers to sign in from the browser first, and the token form as the alternative', () => {
    render(<OnboardingView />);
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
    expect(screen.getByText('or paste a token')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('data-variant')).toBe(
      'secondary',
    );
    expect(screen.queryByText(/not available in this build/)).toBeNull();
  });

  it('explains both token types and links to pre-filled creation pages', () => {
    render(<OnboardingView />);
    expect(screen.getByRole('heading', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Classic token' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fine-grained token' })).toBeTruthy();
    expect(screen.getByText(/does not offer the Checks permission/)).toBeTruthy();

    const classic = screen.getByRole('link', { name: 'Create a classic token' });
    expect(classic.getAttribute('href')).toBe(TOKEN_URLS.classic);
    expect(classic.getAttribute('href')).toContain('scopes=repo');
    const fine = screen.getByRole('link', { name: 'Create a fine-grained token' });
    expect(fine.getAttribute('href')).toBe(TOKEN_URLS.fineGrained);
  });

  it('opens a creation page in a tab instead of navigating the panel', () => {
    render(<OnboardingView />);
    const click = fireEvent.click(screen.getByRole('link', { name: 'Create a classic token' }));
    expect(click).toBe(false); // default prevented
    expect(fakeChrome().__state.createdTabs).toEqual([{ url: TOKEN_URLS.classic }]);
  });

  it('keeps the token hidden and asks for one when the field is empty', async () => {
    const fetch = stubGitHub();
    render(<OnboardingView />);
    expect(field().type).toBe('password');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(screen.getByText('Paste a token to sign in.')).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs in: stores the account, polls and shows the list', async () => {
    stubGitHub();
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    location.hash = '#/onboarding';
    render(<OnboardingView />);

    await submit(`  ${TOKEN} `);

    await waitFor(() => expect(location.hash).toBe('#/'));
    const { auth } = await chrome.storage.local.get('auth');
    expect(auth).toMatchObject({
      method: 'pat',
      token: TOKEN,
      tokenType: 'classic',
      scopes: ['repo'],
      viewer: viewerNode(),
    });
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
    expect(toasts.value).toEqual([]);
  });

  it('signs in with a warning when the classic token lacks the repo scope', async () => {
    stubGitHub('read:user');
    render(<OnboardingView />);

    await submit(TOKEN);

    await waitFor(() => expect(toasts.value).toHaveLength(1));
    expect(toasts.value[0]?.message).toMatch(
      /^Signed in as octocat\. This token has no repo scope/,
    );
    expect((await chrome.storage.local.get('auth')).auth).toBeDefined();
  });

  it('shows an inline error for a rejected token, without echoing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: `Bad credentials ${TOKEN}` }, { status: 401 })),
    );
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    render(<OnboardingView />);

    await submit(TOKEN);

    await waitFor(() => expect(screen.getByText(/GitHub rejected this token/)).toBeTruthy());
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field());
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('aria-busy')).toBeNull();
    expect((await chrome.storage.local.get('auth')).auth).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(location.hash).not.toBe('#/');
  });

  it('shows progress and ignores a second submit while validating', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      await gate;
      return String(input).endsWith('/graphql')
        ? jsonResponse({ data: { viewer: viewerNode() } })
        : jsonResponse({}, { headers: { 'x-oauth-scopes': 'repo' } });
    });
    vi.stubGlobal('fetch', fetch);
    render(<OnboardingView />);

    await submit(TOKEN);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    expect(fetch).toHaveBeenCalledTimes(2); // viewer + user, once

    await act(async () => release());
    await waitFor(() => expect(location.hash).toBe('#/'));
  });

  it('fails visibly when the account cannot be stored', async () => {
    stubGitHub();
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('quota'));
    render(<OnboardingView />);

    await submit(TOKEN);

    await waitFor(() => expect(screen.getByText('Could not sign in. Try again.')).toBeTruthy());
  });
});

describe('OnboardingView in a build without an OAuth client id', () => {
  const clientId = env.clientId;
  beforeEach(() => {
    Object.assign(env, { clientId: '' });
  });
  afterEach(() => {
    Object.assign(env, { clientId });
  });

  it('shows browser sign-in as unavailable with a link to the docs, and no dead button', () => {
    render(<OnboardingView />);

    expect(
      screen.getByText(/Signing in from the browser is not available in this build/),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'How to sign in with a token' }).getAttribute('href'),
    ).toBe(AUTH_DOCS_URL);
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull();
    expect(screen.queryByText('or paste a token')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('data-variant')).toBe(
      'primary',
    );
  });

  it('opens the docs in a tab', () => {
    render(<OnboardingView />);
    fireEvent.click(screen.getByRole('link', { name: 'How to sign in with a token' }));
    expect(fakeChrome().__state.createdTabs).toEqual([{ url: AUTH_DOCS_URL }]);
  });
});
