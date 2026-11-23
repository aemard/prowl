/**
 * Whose turn when GitHub's verdict and the list's facts disagree: optional checks failing
 * (`unstable`), a ready PR the viewer may not merge, conversations open while checks still run,
 * and a person's comment followed by a bot's.
 */
import { describe, expect, it } from 'vitest';
import { buildPullRequest, buildSnapshotOf } from '../../test/panel';
import type { CheckSummary, PullRequest } from '../model';
import { turnSummary, whoseTurn } from './whoseTurn';

const PUSHED = '2026-10-05T10:00:00.000Z';
const ASKED = '2026-10-05T11:00:00.000Z';
const REPORTED = '2026-10-05T12:00:00.000Z';
const me = { login: 'Me', avatarUrl: '', isBot: false };
const mine = (overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({ author: me, lastCommitAt: PUSHED, ...overrides });
const checks = (failed: number, pending = 0): CheckSummary => ({
  state: failed > 0 ? 'failure' : pending > 0 ? 'pending' : 'success',
  total: 2,
  passed: 2 - failed - pending,
  failed,
  pending,
  neutral: 0,
});
const approved = { reviewDecision: 'approved' } as const;

describe('whoseTurn against GitHub’s merge verdict', () => {
  it.each<[string, Partial<PullRequest>, Partial<ReturnType<typeof whoseTurn>>]>([
    // Only optional checks fail: GitHub lets it merge, so it is the merge's turn.
    [
      'unstable, optional check failing',
      { ...approved, mergeStateStatus: 'unstable', checks: checks(1) },
      { owner: 'you', reason: 'ready_to_merge' },
    ],
    [
      'unstable, no review required',
      { reviewDecision: 'none', mergeStateStatus: 'unstable', checks: checks(1) },
      { owner: 'you', reason: 'ready_to_merge' },
    ],
    // Blocked, or a verdict not read yet: the failure may be a required check.
    [
      'blocked, check failing',
      { ...approved, mergeStateStatus: 'blocked', checks: checks(1) },
      { owner: 'you', reason: 'ci_failed' },
    ],
    [
      'unknown verdict, check failing',
      { ...approved, mergeStateStatus: 'unknown', checks: checks(1) },
      { owner: 'you', reason: 'ci_failed' },
    ],
    [
      'clean, but the viewer may not merge',
      { ...approved, mergeStateStatus: 'clean', viewerCanMerge: false },
      { owner: 'them', reason: 'waiting_on_merge' },
    ],
    [
      'unstable, optional failing, the viewer may not merge',
      { ...approved, mergeStateStatus: 'unstable', checks: checks(1), viewerCanMerge: false },
      { owner: 'them', reason: 'waiting_on_merge' },
    ],
    // A running check may be the required one that blocks it, not the open conversations.
    [
      'blocked, conversations open, a check running',
      { ...approved, mergeStateStatus: 'blocked', unresolvedThreads: 1, checks: checks(0, 1) },
      { owner: 'them', reason: 'waiting_on_checks' },
    ],
    [
      'blocked, conversations open, checks passed',
      { ...approved, mergeStateStatus: 'blocked', unresolvedThreads: 1, checks: checks(0) },
      { owner: 'you', reason: 'unresolved_threads' },
    ],
  ])('%s', (_, overrides, expected) => {
    expect(whoseTurn(mine(overrides), 'me')).toMatchObject(expected);
  });

  it('never counts a PR that waits only for someone to merge it as stuck', () => {
    const old = '2026-09-01T10:00:00.000Z';
    const waiting = mine({ ...approved, mergeStateStatus: 'clean', viewerCanMerge: false });
    const snapshot = buildSnapshotOf(
      { authored: [{ ...waiting, lastCommitAt: old }] },
      { viewer: { login: 'me', avatarUrl: '', name: null } },
    );
    expect(turnSummary(snapshot, Date.parse(REPORTED))).toMatchObject({ waiting: 0, stuck: 0 });
  });
});

describe('whoseTurn on a person’s comment followed by a bot’s', () => {
  const bot = { author: 'codecov', isBot: true, createdAt: REPORTED };
  it.each<[string, Partial<PullRequest>, string]>([
    [
      'a question, then a coverage report',
      { lastComment: bot, lastHumanComment: { author: 'bob', createdAt: ASKED } },
      'feedback',
    ],
    [
      'your reply, then a coverage report',
      { lastComment: bot, lastHumanComment: { author: 'me', createdAt: ASKED } },
      'waiting_on_reviewers',
    ],
    ['bots only', { lastComment: bot, lastHumanComment: null }, 'waiting_on_reviewers'],
    // Stored before Prowl read the last few: the latest comment alone, a bot's ignored.
    ['an older snapshot, a bot last', { lastComment: bot }, 'waiting_on_reviewers'],
    [
      'an older snapshot, a person last',
      { lastComment: { author: 'bob', isBot: false, createdAt: ASKED } },
      'feedback',
    ],
  ])('%s', (_, overrides, reason) => {
    expect(whoseTurn(mine(overrides), 'me').reason).toBe(reason);
  });
});
