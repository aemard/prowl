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

/** A chip on a card, not the section tab of the same name. */
const chip = (text: string) =>
  screen.queryAllByText(text).find((el) => el.closest('.pr-card__chips'));

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
    expect(screen.getByText('Fix CI · 1 failing')).toBeTruthy();
    expect(chip('Review')?.closest('[title]')?.getAttribute('title')).toMatch(
      /^Your turn: Review, since /,
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
    expect(screen.getByText('Fix CI · 1 failing')).toBeTruthy();
    expect(chip('Review')).toBeUndefined();
  });
});
