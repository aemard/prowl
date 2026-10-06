import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuth, buildPollState, buildPullRequest, buildSnapshotOf } from '../test/panel';
import { App } from './App';
import { navigate } from './state/router';
import { hydrated, hydrateStore } from './state/store';

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  location.hash = '';
  delete document.documentElement.dataset.theme;
});

async function open(stored: Record<string, unknown> = {}) {
  await chrome.storage.local.set(stored);
  await act(async () => {
    stop = await hydrateStore();
  });
  return render(<App />);
}

const theme = () => document.documentElement.dataset.theme;

describe('App', () => {
  it('shows a labelled skeleton until the store is hydrated', async () => {
    const pending = hydrateStore();
    render(<App />);
    expect(hydrated.value).toBe(false);
    expect(screen.getByRole('main', { name: 'Loading' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading');
    expect(screen.getByRole('heading', { name: 'Prowl' })).toBeTruthy();

    await act(async () => {
      stop = await pending;
    });
    // The loading status is gone; only the (empty) refresh announcer remains.
    expect(screen.queryAllByRole('status').map((s) => s.textContent)).toEqual(['']);
    expect(screen.getByRole('main', { name: 'Sign in' })).toBeTruthy();
  });

  it('lands signed-out users on onboarding', async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('lands signed-in users on the list with the header controls', async () => {
    await open({ auth: buildAuth() });
    expect(screen.getByRole('main', { name: 'Pull requests' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading pull requests' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('switches views and moves focus into the new one, but not on first load', async () => {
    await open({ auth: buildAuth() });
    expect(document.body.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const settings = await screen.findByRole('main', { name: 'Settings' });
    expect(document.activeElement).toBe(settings);

    await act(() => navigate('list'));
    expect(document.activeElement).toBe(screen.getByRole('main', { name: 'Pull requests' }));
  });

  it('shows onboarding when the user signs out, and the list when they sign in', async () => {
    await open({ auth: buildAuth() });
    await act(() => chrome.storage.local.remove('auth'));
    expect(screen.getByRole('main', { name: 'Sign in' })).toBeTruthy();

    await act(() => chrome.storage.local.set({ auth: buildAuth('hubot') }));
    expect(screen.getByRole('main', { name: 'Pull requests' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account: hubot' })).toBeTruthy();
  });

  it('applies the theme from settings and follows changes', async () => {
    await open({ settings: { theme: 'dark' } });
    expect(theme()).toBe('dark');

    await act(() => chrome.storage.local.set({ settings: { theme: 'light' } }));
    expect(theme()).toBe('light');

    await act(() => chrome.storage.local.set({ settings: { theme: 'system' } }));
    expect(theme()).toBeUndefined();
  });

  it('shows a banner above the list without hiding it, and not on the sign-in screen', async () => {
    const pr = buildPullRequest({ number: 7, title: 'Still readable' });
    await open({
      auth: buildAuth(),
      snapshot: buildSnapshotOf({ authored: [pr] }),
      pollState: buildPollState({
        lastError: { kind: 'unauthorized', message: 'Bad credentials' },
      }),
    });
    expect(screen.getByRole('alert').textContent).toContain('token was revoked or expired');
    expect(screen.getByRole('link', { name: /Still readable/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Re-authenticate' }));
    expect(await screen.findByRole('main', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('mounts the toast region once', async () => {
    await open();
    expect(screen.getAllByRole('region', { name: 'Messages' })).toHaveLength(1);
  });
});
