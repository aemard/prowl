import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { buildAuth } from '../../test/panel';
import { auth, settings, teams } from '../state/store';
import { group, open, teamsState, toggle } from './Settings.test-support';
import { TeamReviewsHeader } from './SettingsTeams';

afterEach(() => {
  auth.value = undefined;
  teams.value = undefined;
  settings.value = defaultSettings();
});

describe('inline team picker', () => {
  it('appears only when enabled in Sections and keeps focus on its disclosure', async () => {
    await open({}, undefined, { teams: teamsState() });
    expect(screen.queryByRole('button', { name: 'Edit teams' })).toBeNull();
    fireEvent.click(toggle('Team reviews'));
    const edit = await screen.findByRole('button', { name: 'Edit teams' });
    edit.focus();
    expect(edit.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(edit);
    expect(edit.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(edit);
    expect(group('Sections').queryByRole('switch', { name: 'Ops' })).toBeNull();
    fireEvent.click(edit);
    expect(screen.getByRole('switch', { name: 'Ops' })).toBeTruthy();
  });

  it('shows the cap as information and labels teams beyond the checked ten', () => {
    auth.value = buildAuth();
    teams.value = teamsState({
      teams: Array.from({ length: 12 }, (_, index) => ({
        org: 'acme',
        slug: `t${index}`,
        name: `Team ${index}`,
      })),
    });
    render(<TeamReviewsHeader />);
    expect(screen.getByText('Checking the first 10 of 12 teams, by name')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit teams' }));
    expect(screen.getAllByRole('switch')).toHaveLength(12);
    expect(screen.getAllByText(/Not checked. Unfollow another team/)).toHaveLength(2);
  });

  it('shows no-team and missing scope information once even with the picker open', async () => {
    auth.value = buildAuth();
    teams.value = teamsState({ teams: [] });
    render(<TeamReviewsHeader />);
    expect(screen.getByText('GitHub lists no team for your account.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit teams' }));
    await act(() => {
      teams.value = teamsState({
        teams: [],
        error: { kind: 'missing_scope', message: 'Needs read:org' },
      });
    });
    expect(screen.getAllByText('Needs read:org')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Sign in again' })).toHaveLength(1);
  });

  it('discovers automatically and shows loading without a cache', async () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    auth.value = buildAuth();
    render(<TeamReviewsHeader />);
    expect(screen.getByText('Loading your teams…')).toBeTruthy();
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'refreshTeams' }));
  });

  it('uses the singular count', () => {
    auth.value = buildAuth();
    teams.value = teamsState({ teams: teamsState().teams.slice(0, 1) });
    render(<TeamReviewsHeader />);
    expect(screen.getByText('Following 1 team')).toBeTruthy();
  });
});
