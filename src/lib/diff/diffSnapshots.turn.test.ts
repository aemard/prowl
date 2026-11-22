import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../model';
import { diffSnapshots } from './diffSnapshots';
import {
  COMMENTED,
  ci,
  comments,
  pr,
  REVIEWED,
  review,
  reviews,
  snapshot,
  VIEWER,
  YESTERDAY,
} from './diffSnapshots.test-support';

const PUSHED = YESTERDAY;
const turns = (before: Partial<PullRequest>, after: Partial<PullRequest>) =>
  diffSnapshots(snapshot([pr(before)]), snapshot([pr(after)]), VIEWER).map(({ type, reason }) =>
    reason ? [type, reason] : [type],
  );

/** Someone else's PR, so the viewer reviews it. */
const theirs = (overrides: Partial<PullRequest> = {}): Partial<PullRequest> => ({
  author: { login: 'hubot', avatarUrl: '', isBot: false },
  lastCommitAt: PUSHED,
  ...overrides,
});

describe('diffSnapshots turn events beside the events that tell them', () => {
  it('gives the turn of a teammate’s question with the comment', () => {
    const before = { lastCommitAt: PUSHED, ...comments(0) };
    const after = { lastCommitAt: PUSHED, ...comments(1, 'monalisa', COMMENTED) };
    expect(turns(before, after)).toEqual([['comment_new'], ['your_turn', 'feedback']]);
  });

  it('gives the turn of failing checks with the failure', () => {
    expect(turns(ci('success'), ci('failure'))).toEqual([
      ['ci_failed'],
      ['your_turn', 'ci_failed'],
    ]);
  });

  it('gives a review asked of the viewer with a stranger’s review', () => {
    const after = theirs({
      requestedReviewers: [VIEWER],
      ...reviews(review('monalisa', 'commented', REVIEWED)),
    });
    expect(turns(theirs(), after)).toEqual([['review_requested'], ['review_new']]);
  });

  it('keeps the ids of a repeated poll', () => {
    const prev = snapshot([pr(ci('success'))]);
    const next = snapshot([pr(ci('failure'))]);
    const ids = diffSnapshots(prev, next, VIEWER).map(({ id }) => id);
    expect(diffSnapshots(structuredClone(prev), structuredClone(next), VIEWER)).toEqual(
      diffSnapshots(prev, next, VIEWER),
    );
    expect(ids).toHaveLength(2);
  });
});
