import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { navigate } from '../state/router';
import { auth, pollState, snapshot } from '../state/store';
import { Header } from './Header';

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
});
