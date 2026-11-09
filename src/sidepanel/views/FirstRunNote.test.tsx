import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeOnboarding } from '../../lib/storage/onboarding';
import { getItem } from '../../lib/storage/storage';
import { buildAuth } from '../../test/panel';
import { auth, hydrateStore, onboarding, teams } from '../state/store';
import { FirstRunNote } from './FirstRunNote';
import { teamsState } from './Settings.test-support';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  auth.value = undefined;
  onboarding.value = undefined;
  teams.value = undefined;
});

async function open(reason: 'install' | 'update' = 'install') {
  await initializeOnboarding(reason);
  await act(async () => {
    stop = await hydrateStore();
  });
  auth.value = buildAuth();
  render(<FirstRunNote />);
}

describe('first-run note', () => {
  it('shows only on a fresh installation and never returns after dismissal', async () => {
    await open('update');
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    cleanup();
    stop?.();
    await chrome.storage.local.remove('onboarding');
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull());
    cleanup();
    stop?.();
    await open();
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
  });

  it('enables the notification master switch and dismisses the note', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull());
    expect((await getItem('settings'))?.notifications.enabled).toBe(true);
  });

  it('offers Show Team reviews only for discovered teams of this account', async () => {
    await open();
    expect(screen.queryByRole('button', { name: 'Show Team reviews' })).toBeNull();
    await act(() => {
      teams.value = teamsState({ teams: teamsState().teams.slice(0, 1) });
    });
    expect(screen.getByText(/You're in 1 team ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show Team reviews' }));
    await waitFor(async () => {
      const sections = (await getItem('settings'))?.sections ?? [];
      expect(sections.find((s) => s.kind === 'team_review_requested')?.enabled).toBe(true);
    });
    await act(() => {
      teams.value = teamsState({ login: 'another-account' });
    });
    expect(screen.queryByRole('button', { name: 'Show Team reviews' })).toBeNull();
  });
});
