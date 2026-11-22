import { describe, expect, it } from 'vitest';
import { buildPullRequest, buildSnapshotOf } from '../../test/panel';
import type { PullRequest, Review } from '../model';
import { turnSummary, whoseTurn } from './whoseTurn';

const PUSHED = '2026-10-05T10:00:00.000Z';
const FEEDBACK = '2026-10-05T11:00:00.000Z';
const REPLIED = '2026-10-05T12:00:00.000Z';
const LATER = '2026-10-05T13:00:00.000Z';
const me = { login: 'Me', avatarUrl: '', isBot: false };
const review = (author: string, state: Review['state'], submittedAt: string): Review => ({
  id: `R_${author}_${submittedAt}`,
  author,
  isBot: false,
  state,
  submittedAt,
});
const mine = (overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({ author: me, lastCommitAt: PUSHED, ...overrides });
const turn = (pr: PullRequest) => whoseTurn(pr, 'me');
const approved = { reviewDecision: 'approved' } as const;
const ready = { ...approved, mergeStateStatus: 'clean' } as const;

describe('whoseTurn once your pull request has nothing to fix', () => {
  it('is nobody’s move while the merge queue holds it, ready or not', () => {
    expect(turn(mine({ ...ready, inMergeQueue: true }))).toMatchObject({
      owner: 'none',
      reason: 'in_merge_queue',
    });
    expect(turn(mine({ inMergeQueue: true, mergeStateStatus: 'blocked' })).reason).toBe(
      'in_merge_queue',
    );
  });

  it('asks you to update a branch that strict checks hold behind its base', () => {
    const behind = { ...approved, mergeStateStatus: 'behind' } as const;
    expect(turn(mine(behind))).toMatchObject({ owner: 'you', reason: 'update_branch' });
    // Nobody but someone who can push may update it; reviews still owed come first.
    expect(turn(mine({ ...behind, viewerCanUpdate: false })).reason).toBe('waiting_on_reviewers');
    expect(turn(mine({ ...behind, reviewDecision: 'review_required' })).reason).toBe(
      'waiting_on_reviewers',
    );
  });

  it('asks you to resolve the conversations that block a reviewed PR', () => {
    const blocked = { ...approved, mergeStateStatus: 'blocked', unresolvedThreads: 2 } as const;
    expect(turn(mine(blocked))).toMatchObject({ owner: 'you', reason: 'unresolved_threads' });
    expect(turn(mine({ ...blocked, unresolvedThreads: 0 })).reason).toBe('waiting_on_reviewers');
    expect(turn(mine({ ...blocked, reviewDecision: 'review_required' })).owner).toBe('them');
  });

  it('is nobody’s move while GitHub’s merge facts are unknown, and never stuck', () => {
    const unknown = mine({ mergeStateStatus: 'unknown', lastCommitAt: '2026-09-01T10:00:00Z' });
    expect(turn(unknown)).toMatchObject({ owner: 'none', reason: 'merge_unknown' });
    const snapshot = buildSnapshotOf(
      { authored: [unknown] },
      { viewer: { login: 'me', avatarUrl: '', name: null } },
    );
    expect(turnSummary(snapshot, Date.parse(LATER)).stuck).toBe(0);
  });
});

describe('whoseTurn on feedback you answered', () => {
  const feedback = review('bob', 'commented', FEEDBACK);

  it('hands the move back once you replied in a review or a comment', () => {
    expect(turn(mine({ reviews: [feedback] })).reason).toBe('feedback');
    const byReview = mine({ reviews: [review('me', 'commented', REPLIED), feedback] });
    expect(turn(byReview).owner).toBe('them');
    const byComment = mine({
      reviews: [feedback],
      lastComment: { author: 'me', isBot: false, createdAt: REPLIED },
    });
    expect(turn(byComment).owner).toBe('them');
  });

  it('is your move again on feedback newer than your reply, since the oldest unanswered', () => {
    const pr = mine({
      reviews: [review('carol', 'commented', LATER), review('me', 'commented', REPLIED), feedback],
      lastComment: { author: 'dave', isBot: false, createdAt: LATER },
    });
    expect(turn(pr)).toEqual({ owner: 'you', reason: 'feedback', since: LATER });
    const two = mine({
      reviews: [feedback],
      lastComment: { author: 'dave', isBot: false, createdAt: LATER },
    });
    expect(turn(two).since).toBe(FEEDBACK);
  });
});
