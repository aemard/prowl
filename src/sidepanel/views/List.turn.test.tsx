import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshotOf } from '../../test/panel';
import { snapshot } from '../state/store';
import { ListView } from './List';
import { cardTitles, pr, withSections } from './List.test-support';

const failing = {
  state: 'failure',
  total: 1,
  passed: 0,
  failed: 1,
  pending: 0,
  neutral: 0,
} as const;

describe('Your turn section', () => {
  beforeEach(() => {
    withSections(['authored', 'review_requested', 'your_turn']);
    const viewer = snapshot.value?.viewer.login ?? 'octocat';
    const me = { login: viewer, avatarUrl: '', isBot: false };
    snapshot.value = buildSnapshotOf({
      authored: [
        pr(1, { author: me, title: 'Mine, red', checks: failing }),
        pr(2, { author: me, title: 'Mine, waiting' }),
      ],
      review_requested: [
        pr(3, {
          title: 'Asked of me',
          requestedReviewers: [viewer],
          lastCommitAt: '2026-10-02T09:00:00.000Z',
        }),
      ],
    });
  });

  it('lists the pull requests of every section where it is your move, with why', () => {
    render(<ListView />);
    const tab = screen.getByRole('tab', { name: /^Your turn/ });
    expect(tab.textContent).toBe('Your turn2');
    fireEvent.click(tab);
    expect(cardTitles()).toEqual(['Asked of me', 'Mine, red']);
    expect(screen.getByText('Fix CI')).toBeTruthy();
    expect(screen.getByText('Your review').closest('[title]')?.getAttribute('title')).toMatch(
      /^Your turn: Your review, since /,
    );
  });

  it('sums up the queue above the list', () => {
    render(<ListView />);
    fireEvent.click(screen.getByRole('tab', { name: /^Your turn/ }));
    expect(document.querySelector('.turn-summary')?.textContent).toMatch(
      /^Waiting on you: 2, the oldest since .+ ago\./,
    );
  });

  it('shows the chip on cards of the other sections too', () => {
    render(<ListView />);
    expect(screen.getByText('Fix CI')).toBeTruthy();
    expect(screen.queryByText('Your review')).toBeNull();
  });
});

describe('stacked pull requests', () => {
  it('says which pull request a card is stacked on', () => {
    withSections(['authored']);
    snapshot.value = buildSnapshotOf({
      authored: [
        pr(1, { headRefName: 'part-1' }),
        pr(2, { title: 'Part 2', headRefName: 'part-2', baseRefName: 'part-1' }),
      ],
    });
    render(<ListView />);
    expect(screen.getByText('On #1').closest('[title]')?.getAttribute('title')).toBe(
      'Stacked on #1 (PR number 1): it merges after it',
    );
  });
});
