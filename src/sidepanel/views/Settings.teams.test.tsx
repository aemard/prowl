import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { buildAuth } from '../../test/panel';
import { auth, settings, teams } from '../state/store';
import { group, open, teamsState, toggle } from './Settings.test-support';
import { TeamPicker } from './SettingsTeams';

afterEach(() => {
  auth.value = undefined;
  teams.value = undefined;
  settings.value = defaultSettings();
});

describe('inline team picker', () => {
  it('appears inline only while Team reviews is enabled', async () => {
    await open({}, undefined, { teams: teamsState() });
    expect(screen.queryByRole('switch', { name: '@acme/ops' })).toBeNull();
    fireEvent.click(toggle('Team reviews'));
    expect(await screen.findByRole('switch', { name: '@acme/ops' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit teams' })).toBeNull();
    fireEvent.click(toggle('Team reviews'));
    await waitFor(() =>
      expect(group('Sections').queryByRole('switch', { name: '@acme/ops' })).toBeNull(),
    );
  });

  it('shows every team without cap or freshness copy', () => {
    auth.value = buildAuth();
    teams.value = teamsState({
      teams: Array.from({ length: 12 }, (_, index) => ({
        org: 'acme',
        slug: `t${index}`,
        name: `Team ${index}`,
      })),
    });
    render(<TeamPicker />);
    expect(screen.queryByText(/Checking the first/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(12);
    expect(screen.queryByText(/Not checked/)).toBeNull();
  });

  it('shows no-team and missing scope information once even with the picker open', async () => {
    auth.value = buildAuth();
    teams.value = teamsState({ teams: [] });
    render(<TeamPicker />);
    expect(screen.getByText('GitHub lists no team for your account.')).toBeTruthy();
    await act(() => {
      teams.value = teamsState({
        teams: [],
        error: { kind: 'missing_scope', message: 'Needs read:org' },
      });
    });
    expect(screen.getAllByText("Prowl can't see your teams.")).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Sign in again' })).toHaveLength(1);
  });

  it('discovers automatically and shows loading without a cache', async () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    auth.value = buildAuth();
    render(<TeamPicker />);
    expect(screen.getByText('Loading your teams…')).toBeTruthy();
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'refreshTeams' }));
  });

  it('offers retry after discovery failure', () => {
    auth.value = buildAuth();
    teams.value = teamsState({ error: { kind: 'server', message: 'Down' } });
    render(<TeamPicker />);
    expect(screen.getByText("Couldn't load your teams.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
