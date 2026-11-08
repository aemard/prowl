import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { settings, teams } from '../state/store';
import { group, open, teamsState } from './Settings.test-support';
import { TeamReviewsHeader } from './SettingsTeams';

afterEach(() => {
  teams.value = undefined;
  settings.value = defaultSettings();
});

describe('Team picker entry points', () => {
  it('opens from Sections, traps focus and restores it on Done', async () => {
    await open({}, undefined, { teams: teamsState() });
    const choose = group('Sections').getByRole('button', { name: 'Choose teams' });
    choose.focus();
    fireEvent.click(choose);
    const dialog = screen.getByRole('dialog', { name: 'Team reviews' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const done = within(dialog).getByRole('button', { name: 'Done' });
    done.focus();
    fireEvent.keyDown(done, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(done);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(choose);
  });

  it('shows the cap as information and opens the same picker from the header', () => {
    teams.value = teamsState({
      teams: Array.from({ length: 12 }, (_, index) => ({
        org: 'acme',
        slug: `t${index}`,
        name: `Team ${index}`,
      })),
    });
    render(<TeamReviewsHeader />);
    expect(screen.getByText(/Checking 10 of 12 teams/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const choose = screen.getByRole('button', { name: 'Choose teams' });
    choose.focus();
    fireEvent.click(choose);
    const dialog = screen.getByRole('dialog', { name: 'Team reviews' });
    expect(within(dialog).getAllByRole('switch')).toHaveLength(12);
    expect(within(dialog).getByText(/Prowl checks at most 10 teams each refresh/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(document.activeElement).toBe(choose);
  });

  it('shows following count and no-team information without an error', () => {
    teams.value = teamsState({ teams: [] });
    render(<TeamReviewsHeader />);
    expect(screen.getByText(/Following 0 teams/)).toBeTruthy();
    expect(screen.getByText('GitHub lists no team for your account.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
