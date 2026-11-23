import { describe, expect, it } from 'vitest';
import { buildPullRequest, buildSnapshotOf } from '../../test/panel';
import type { PullRequest, Review } from '../model';
import { turnSummary, whoseTurn, yourTurnIds } from './whoseTurn';

const PUSHED = '2026-10-05T10:00:00.000Z';
const BEFORE = '2026-10-05T09:00:00.000Z';
const AFTER = '2026-10-05T11:00:00.000Z';
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
const theirs = (overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({ lastCommitAt: PUSHED, ...overrides });
const turn = (pr: PullRequest, teams: string[] = []) => whoseTurn(pr, 'me', teams);
const failing = {
  state: 'failure',
  total: 1,
  passed: 0,
  failed: 1,
  pending: 0,
  neutral: 0,
} as const;
const running = { ...failing, state: 'pending', failed: 0, pending: 1 } as const;

describe('whoseTurn on your own pull requests', () => {
  it.each<[string, Partial<PullRequest>, string]>([
    ['failing CI', { checks: failing }, 'ci_failed'],
    [
      'changes asked after the push',
      { reviews: [review('bob', 'changes_requested', AFTER)] },
      'changes_requested',
    ],
    ['conflicts', { mergeable: 'conflicting' }, 'conflicts'],
    [
      'a review comment after the push',
      { reviews: [review('bob', 'commented', AFTER)] },
      'feedback',
    ],
    [
      'a comment after the push',
      { lastComment: { author: 'bob', isBot: false, createdAt: AFTER } },
      'feedback',
    ],
    [
      'ready to merge',
      {
        mergeStateStatus: 'clean',
        reviewDecision: 'approved',
        reviews: [review('bob', 'approved', AFTER)],
      },
      'ready_to_merge',
    ],
  ])('is your move on %s', (_, overrides, reason) => {
    expect(turn(mine(overrides))).toMatchObject({ owner: 'you', reason });
  });

  it('hands the move back to reviewers once you pushed after their feedback', () => {
    const pr = mine({
      reviews: [review('bob', 'changes_requested', BEFORE)],
      lastComment: { author: 'bob', isBot: false, createdAt: BEFORE },
    });
    expect(turn(pr)).toEqual({ owner: 'them', reason: 'waiting_on_reviewers', since: PUSHED });
  });

  it('ignores your own and bots’ comments, and waits on running checks', () => {
    const comment = (author: string, isBot: boolean) => ({ author, isBot, createdAt: AFTER });
    expect(turn(mine({ lastComment: comment('me', false) })).owner).toBe('them');
    expect(turn(mine({ lastComment: comment('github-actions', true) })).owner).toBe('them');
    // GraphQL says who is a bot: a person whose login ends in "bot" still asks you something.
    expect(turn(mine({ lastComment: comment('talbot', false) })).reason).toBe('feedback');
    expect(turn(mine({ checks: running })).reason).toBe('waiting_on_checks');
  });

  it('takes a bot’s review comments for no feedback, its requested changes for some', () => {
    const bot = (state: Review['state']) => ({ ...review('copilot', state, AFTER), isBot: true });
    expect(turn(mine({ reviews: [bot('commented')] }))).toMatchObject({
      owner: 'them',
      reason: 'waiting_on_reviewers',
    });
    expect(turn(mine({ reviews: [bot('changes_requested')] })).reason).toBe('changes_requested');
    const both = mine({ reviews: [bot('commented'), review('bob', 'commented', AFTER)] });
    expect(turn(both).reason).toBe('feedback');
  });

  it('is nobody’s move once auto-merge is on and it is ready', () => {
    const ready = { mergeStateStatus: 'clean', reviewDecision: 'approved' } as const;
    const autoMerge = { method: 'squash', enabledBy: 'me' } as const;
    expect(turn(mine({ ...ready, autoMerge }))).toMatchObject({
      owner: 'none',
      reason: 'auto_merge',
    });
    // Not ready yet: what blocks it is still someone's move.
    expect(turn(mine({ checks: failing, autoMerge })).reason).toBe('ci_failed');
    expect(turn(mine({ checks: running, autoMerge })).reason).toBe('waiting_on_checks');
  });

  it('is not your move to merge without write access', () => {
    const pr = mine({ mergeStateStatus: 'clean', viewerCanMerge: false });
    expect(turn(pr).owner).toBe('them');
  });
});

describe('whoseTurn on other pull requests', () => {
  it('is your move when your review is requested, matching logins case-insensitively', () => {
    expect(turn(theirs({ requestedReviewers: ['ME'] }))).toMatchObject({
      owner: 'you',
      reason: 'review_requested',
      since: PUSHED,
    });
  });

  it('asks you to review again after a push that follows your requested changes', () => {
    expect(turn(theirs({ reviews: [review('me', 'changes_requested', BEFORE)] }))).toMatchObject({
      owner: 'you',
      reason: 're_review',
    });
    expect(turn(theirs({ reviews: [review('me', 'changes_requested', AFTER)] })).owner).toBe(
      'them',
    );
  });

  it("is your team's move on a team request, else the author's", () => {
    expect(turn(theirs(), ['acme/web']).owner).toBe('team');
    expect(turn(theirs()).reason).toBe('waiting_on_author');
  });

  it('is nobody’s move on drafts and closed pull requests', () => {
    expect(turn(theirs({ isDraft: true, requestedReviewers: ['me'] })).owner).toBe('none');
    expect(turn(mine({ state: 'merged' })).reason).toBe('closed');
  });
});

describe('yourTurnIds', () => {
  it('lists each pull request where it is your move once', () => {
    const older = theirs({
      number: 1,
      requestedReviewers: ['me'],
      createdAt: BEFORE,
      lastCommitAt: BEFORE,
    });
    const newer = mine({ number: 2, checks: failing });
    const waiting = theirs({ number: 3 });
    const snapshot = buildSnapshotOf(
      { authored: [newer], review_requested: [older, waiting], mentioned: [older] },
      { viewer: { login: 'me', avatarUrl: '', name: null } },
    );
    expect([...yourTurnIds(snapshot)].sort()).toEqual([newer.id, older.id].sort());
  });
});

describe('turnSummary', () => {
  it('counts what waits on you, the oldest wait, and your PRs stuck on reviewers', () => {
    const asked = theirs({
      number: 1,
      requestedReviewers: ['me'],
      createdAt: BEFORE,
      lastCommitAt: BEFORE,
    });
    const stuck = mine({ number: 2, lastCommitAt: '2026-10-01T10:00:00.000Z' });
    const fresh = mine({ number: 3 });
    const snapshot = buildSnapshotOf(
      { authored: [stuck, fresh], review_requested: [asked] },
      { viewer: { login: 'me', avatarUrl: '', name: null } },
    );
    expect(turnSummary(snapshot, Date.parse(AFTER) + 1000)).toEqual({
      waiting: 1,
      oldest: BEFORE,
      stuck: 1,
    });
  });
});
