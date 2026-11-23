import { describe, expect, it } from 'vitest';
import { buildPollState, buildPullRequest, buildSnapshotOf } from '../../test/panel';
import type { CheckSummary, PollReason } from '../model';
import { whoseTurn } from '../turn/whoseTurn';
import { CI_WATCH_MS, ciWatched, inboxDue, isTrailing, pollVerdict } from './cadence';

const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const MINUTE = 60_000;
const at = (ms: number) => new Date(ms).toISOString();
const REASONS: PollReason[] = [
  'schedule',
  'startup',
  'inbox',
  'ci',
  'focus',
  'panel',
  'user',
  'change',
];
const AUTOMATIC = REASONS.filter((reason) => reason !== 'user' && reason !== 'change');

const verdict = (
  reason: PollReason,
  state = buildPollState(),
  fetchedAt: string | null = at(NOW - 3 * MINUTE),
) => pollVerdict(reason, state, fetchedAt, 2, NOW);

describe('pollVerdict', () => {
  it('lets every reason poll an idle account whose list is a few minutes old', () => {
    for (const reason of REASONS) expect(verdict(reason)).toEqual({ run: true });
  });

  it('after a rejected token, only explicit reasons (Refresh, a change, sign-in) try again', () => {
    const state = buildPollState({ lastError: { kind: 'unauthorized', message: 'x' } });
    for (const reason of AUTOMATIC)
      expect(verdict(reason, state)).toEqual({ run: false, why: 'unauthorized' });
    expect(verdict('user', state)).toEqual({ run: true });
    expect(verdict('change', state)).toEqual({ run: true });
  });

  it('holds automatic reasons, the panel opening included, during an error backoff', () => {
    const state = buildPollState({
      nextAllowedAt: at(NOW + 5 * MINUTE),
      lastError: { kind: 'network', message: 'x' },
    });
    for (const reason of AUTOMATIC)
      expect(verdict(reason, state)).toEqual({ run: false, why: 'backoff' });
    expect(verdict('user', state)).toEqual({ run: true });
  });

  it('holds every reason during a rate-limit wait, or a low budget after a success', () => {
    for (const lastError of [{ kind: 'rate_limited' as const, message: 'x' }, null]) {
      const state = buildPollState({ nextAllowedAt: at(NOW + 5 * MINUTE), lastError });
      for (const reason of REASONS)
        expect(verdict(reason, state)).toEqual({ run: false, why: 'rate_limited' });
    }
  });

  it('ignores a wait longer than an hour: the clock went back', () => {
    const state = buildPollState({
      nextAllowedAt: at(NOW + 3 * 60 * MINUTE),
      lastError: { kind: 'rate_limited', message: 'x' },
    });
    expect(verdict('schedule', state)).toEqual({ run: true });
  });

  it('polls a list for the panel past a minute, for focus past the interval, for CI past 110 s', () => {
    const fresh = (reason: PollReason, age: number) =>
      verdict(reason, buildPollState(), at(NOW - age)).run;
    expect([fresh('panel', 30_000), fresh('panel', MINUTE)]).toEqual([false, true]);
    expect([fresh('focus', MINUTE), fresh('focus', 2 * MINUTE)]).toEqual([false, true]);
    // With the minute alarm, a CI watch polls every 2 minutes: the poll interval's floor.
    expect([fresh('ci', MINUTE), fresh('ci', 110_000)]).toEqual([false, true]);
    for (const reason of ['schedule', 'startup', 'inbox', 'user', 'change'] as const)
      expect(fresh(reason, 0)).toBe(true);
  });

  it('polls a missing list, and a list dated in the future (the clock went back)', () => {
    expect(verdict('panel', buildPollState(), null)).toEqual({ run: true });
    expect(verdict('focus', buildPollState(), at(NOW + 60 * MINUTE))).toEqual({ run: true });
  });
});

describe('isTrailing', () => {
  it('queues inbox news and changes behind a poll in flight; the rest share it', () => {
    expect(REASONS.filter(isTrailing)).toEqual(['inbox', 'change']);
  });
});

describe('ciWatched', () => {
  const checks = (running: number | undefined): CheckSummary => ({
    state: 'pending',
    total: 1,
    passed: 0,
    failed: 0,
    pending: 1,
    neutral: 0,
    ...(running === undefined ? {} : { running }),
  });
  const watched = (pr: Parameters<typeof buildPullRequest>[0], listed = true) => {
    const built = buildPullRequest({
      author: { login: 'OctoCat', avatarUrl: '', isBot: false },
      updatedAt: at(NOW - 5 * MINUTE),
      lastCommitAt: at(NOW - 5 * MINUTE),
      ...pr,
    });
    const snapshot = buildSnapshotOf({ authored: [built] });
    if (!listed) snapshot.sections = {};
    return ciWatched(snapshot, NOW);
  };

  it("watches running CI on the viewer's own listed open pull request that changed recently", () => {
    expect(watched({ checks: checks(1) })).toBe(true);
  });

  it("ignores CI on other people's pull requests: it never changes the viewer's turn there", () => {
    const teammate = { login: 'alice', avatarUrl: '', isBot: false };
    expect(watched({ checks: checks(1), author: teammate })).toBe(false);
    expect(watched({ checks: checks(1), author: null })).toBe(false);
    // The premise: whatever CI does on a teammate's PR, the viewer's turn there stays the same.
    const states = ['pending', 'failure', 'success'] as const;
    const turns = states.map((state) =>
      whoseTurn(buildPullRequest({ checks: { ...checks(1), state } }), 'octocat'),
    );
    expect(new Set(turns.map((turn) => turn.reason)).size).toBe(1);
  });

  it('ignores waiting checks, old snapshots without running counts, closed and unlisted PRs', () => {
    expect(watched({ checks: checks(0) })).toBe(false);
    expect(watched({ checks: checks(undefined) })).toBe(false);
    expect(watched({ checks: checks(1), state: 'merged' })).toBe(false);
    expect(watched({ checks: checks(1) }, false)).toBe(false);
    expect(ciWatched(undefined, NOW)).toBe(false);
  });

  it('stops an hour after the last push or change, and when dates are in the future', () => {
    const old = at(NOW - CI_WATCH_MS);
    expect(watched({ checks: checks(1), updatedAt: old, lastCommitAt: old })).toBe(false);
    // A push of an old commit still renews the PR's updatedAt.
    expect(watched({ checks: checks(1), lastCommitAt: at(NOW - 3 * CI_WATCH_MS) })).toBe(true);
    const future = at(NOW + MINUTE);
    expect(watched({ checks: checks(1), updatedAt: future, lastCommitAt: future })).toBe(false);
  });
});

describe('inboxDue', () => {
  it('reads the inbox on a list a minute old or more, missing, or dated in the future', () => {
    expect(inboxDue(at(NOW - 30_000), NOW)).toBe(false);
    expect(inboxDue(at(NOW - MINUTE), NOW)).toBe(true);
    expect(inboxDue(null, NOW)).toBe(true);
    expect(inboxDue(at(NOW + MINUTE), NOW)).toBe(true);
  });
});
