import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { navigate } from '../state/router';
import { auth, pollState, snapshot } from '../state/store';
import { Header } from './Header';
import { toasts } from './ui/Toast';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
  auth.value = undefined;
  snapshot.value = undefined;
  pollState.value = undefined;
  location.hash = '';
  toasts.value = [];
});

const signIn = () => {
  auth.value = buildAuth();
};

describe('Header', () => {
  it('shows only the brand while signed out', () => {
    render(<Header />);
    expect(screen.getByRole('heading', { level: 1, name: 'Prowl' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/updated/i)).toBeNull();
  });

  it('says when the data was fetched, and keeps the age current', () => {
    signIn();
    snapshot.value = buildSnapshot('2026-10-06T11:58:00.000Z');
    render(<Header />);
    const time = screen.getByText('Updated 2 min ago');
    expect(time.getAttribute('datetime')).toBe('2026-10-06T11:58:00.000Z');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Updated 3 min ago')).toBeTruthy();
  });

  it('says so before the first fetch and while one is running', () => {
    signIn();
    render(<Header />);
    expect(screen.getByText('Not updated yet')).toBeTruthy();
    act(() => {
      pollState.value = buildPollState({ inFlight: true });
    });
    expect(screen.getByText('Updating…')).toBeTruthy();
  });

  it('asks the service worker for a forced poll and shows progress while it runs', () => {
    signIn();
    const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
    render(<Header />);
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
    expect(refresh.getAttribute('aria-busy')).toBeNull();

    act(() => {
      pollState.value = buildPollState({ inFlight: true });
    });
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(refresh);
    expect(send).toHaveBeenCalledTimes(1);

    act(() => {
      pollState.value = buildPollState({ inFlight: false });
    });
    expect(refresh.getAttribute('aria-busy')).toBeNull();
  });

  it('toggles between the list and settings', () => {
    signIn();
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(location.hash).toBe('#/settings');
    expect(screen.getByRole('button', { name: 'Back to pull requests' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to pull requests' }));
    expect(location.hash).toBe('#/');
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('opens the viewer profile from the account menu', () => {
    signIn();
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Account: octocat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View GitHub profile' }));
    expect(fakeChrome().__state.createdTabs).toEqual([{ url: 'https://github.com/octocat' }]);
  });

  it('reflects the route in the settings button', async () => {
    signIn();
    render(<Header />);
    await act(() => navigate('settings'));
    expect(screen.getByRole('button', { name: 'Back to pull requests' })).toBeTruthy();
  });

  describe('sign out', () => {
    const openConfirmation = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Account: octocat' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    };
    const store = () =>
      chrome.storage.local.set({
        auth: buildAuth(),
        snapshot: buildSnapshot(),
        pollState: buildPollState(),
      });

    it('asks first, and cancelling keeps everything', async () => {
      signIn();
      await store();
      const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
      render(<Header />);
      openConfirmation();

      const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
      expect(dialog.textContent).toMatch(/forgets your token/);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(Object.keys(await chrome.storage.local.get(null))).toEqual([
        'auth',
        'snapshot',
        'pollState',
      ]);
      expect(send).not.toHaveBeenCalled();
    });

    it('removes the account data and tells the worker once confirmed', async () => {
      signIn();
      await store();
      const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
      render(<Header />);
      openConfirmation();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      });

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await chrome.storage.local.get(null)).toEqual({});
      expect(send).toHaveBeenCalledWith({ type: 'signedOut' });
    });

    it('reports a failure and stays signed in', async () => {
      signIn();
      vi.spyOn(chrome.storage.local, 'remove').mockRejectedValue(new Error('storage'));
      render(<Header />);
      openConfirmation();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      });

      await waitFor(() =>
        expect(toasts.value.map((toast) => toast.message)).toEqual([
          'Could not sign out. Try again.',
        ]),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
