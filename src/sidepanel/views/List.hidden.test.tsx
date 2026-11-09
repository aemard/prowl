import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { buildSnapshotOf } from '../../test/panel';
import { prLocal, snapshot } from '../state/store';
import { ListView } from './List';
import { cardTitles, NOW, pr } from './List.test-support';

describe('snoozed and muted pull requests', () => {
  it('sets snoozed PRs aside behind a toggle and flags muted ones', () => {
    const [one, two] = [pr(1), pr(2)];
    snapshot.value = buildSnapshotOf({ authored: [one, two] });
    prLocal.value = {
      snoozed: { [one.id]: new Date(NOW + 3_600_000).toISOString() },
      muted: { [two.id]: true },
      seen: {},
    };
    render(<ListView />);
    expect(cardTitles()).toEqual(['PR number 2']);
    expect(screen.getByText('Notifications muted')).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'Snoozed (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const hidden = screen.getByRole('list', { name: 'Snoozed Created by me pull requests' });
    expect(within(hidden).getByRole('link', { name: /^PR number 1/ })).toBeTruthy();
  });

  it('does not call a fully snoozed section empty or filtered out', () => {
    const only = pr(1);
    snapshot.value = buildSnapshotOf({ authored: [only] });
    prLocal.value = {
      snoozed: { [only.id]: new Date(NOW + 60_000).toISOString() },
      muted: {},
      seen: {},
    };
    render(<ListView />);
    expect(screen.queryByRole('heading', { name: 'No matches' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No pull requests' })).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'All loaded pull requests are snoozed' }),
    ).toBeTruthy();
    expect(screen.getByText('They return here when the snooze ends.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show snoozed' }));
    expect(screen.getByRole('button', { name: 'Snoozed (1)' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByTitle(/^Snoozed until /)).toBeTruthy();
  });
});
