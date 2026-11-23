import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
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
  [...document.querySelectorAll('.pr-card__chips .ui-badge__label')].find(
    (label) => label.textContent === text,
  );

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
    // Newest turn first: "Asked of me" has waited since 2 October.
    expect(cardTitles()).toEqual(['Mine, red', 'Asked of me']);
    // A status that reads as one: whose move it is, then what to do.
    expect(chip('Your turn: Fix CI · 1 failing')).toBeTruthy();
    expect(chip('Your turn: Review')?.closest('[title]')?.getAttribute('title')).toMatch(
      /^Your turn: Review, since /,
    );
  });

  it('sums up the queue above the list', async () => {
    render(<ListView />);
    fireEvent.click(screen.getByRole('tab', { name: /^Your turn/ }));
    await waitFor(() => expect(document.querySelector('.turn-summary')).not.toBeNull());
    expect(document.querySelector('.turn-summary')?.textContent).toMatch(
      /^Waiting on you: 2, the oldest since .+ ago\./,
    );
  });

  it('shows the chip on cards of the other sections too', () => {
    render(<ListView />);
    // A status that reads as one: whose move it is, then what to do.
    expect(chip('Your turn: Fix CI · 1 failing')).toBeTruthy();
    expect(chip('Your turn: Review')).toBeUndefined();
  });
});
