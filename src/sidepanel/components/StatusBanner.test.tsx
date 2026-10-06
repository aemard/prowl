import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { route } from '../state/router';
import { auth, pollState, snapshot } from '../state/store';
import { StatusBanner } from './StatusBanner';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
  auth.value = buildAuth();
  snapshot.value = buildSnapshot('2026-10-06T11:46:00.000Z');
});

afterEach(() => {
  vi.useRealTimers();
  auth.value = undefined;
  snapshot.value = undefined;
  pollState.value = undefined;
  location.hash = '';
});

const failWith = (kind: 'unauthorized' | 'network' | 'server', overrides = {}) => {
  pollState.value = buildPollState({
    lastError: { kind, message: 'Bad gateway' },
    nextAllowedAt: new Date(NOW + 180_000).toISOString(),
    ...overrides,
  });
};

describe('StatusBanner', () => {
  it('renders nothing while all is well', () => {
    snapshot.value = buildSnapshot('2026-10-06T11:59:00.000Z');
    pollState.value = buildPollState();
    const { container } = render(<StatusBanner />);
    expect(container.textContent).toBe('');
  });

  it('announces a rejected token as an alert and opens the sign-in screen from its button', () => {
    failWith('unauthorized');
    render(<StatusBanner />);
    expect(screen.getByRole('alert').textContent).toContain(
      'Your GitHub token was revoked or expired',
    );
    expect(screen.getByText('Last updated 14 min ago.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Re-authenticate' }));
    expect(location.hash).toBe('#/onboarding');
    expect(route.value).toBe('onboarding');
  });

  it('keeps the other problems polite and retries with a forced poll', () => {
    failWith('network', { lastError: { kind: 'network', message: 'Could not reach GitHub.' } });
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    render(<StatusBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Offline — retrying in 3 min');
    expect(status.textContent).toContain('Could not reach GitHub.');
    // The age is outside the live region: it ticks and must not be announced each time.
    expect(status.textContent).not.toContain('Last updated');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
  });

  it('shows a busy retry while a poll runs and counts down as time passes', () => {
    failWith('server', { inFlight: true });
    render(<StatusBanner />);
    expect(screen.getByRole('button', { name: 'Retry' }).getAttribute('aria-busy')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('GitHub error — retrying in 2 min')).toBeTruthy();
    expect(screen.getByText('Last updated 15 min ago.')).toBeTruthy();
  });

  it('goes away when the next poll succeeds', () => {
    failWith('server');
    render(<StatusBanner />);
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      snapshot.value = buildSnapshot(new Date(NOW).toISOString());
      pollState.value = buildPollState({ lastSuccessAt: new Date(NOW).toISOString() });
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
