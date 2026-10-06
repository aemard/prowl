import { describe, expect, it } from 'vitest';
import type { ErrorKind, PollState } from '../../lib/model';
import { buildPollState } from '../../test/panel';
import { describeStatus } from './StatusBannerModel';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const minutes = (n: number) => n * 60_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const clock = (offsetMs: number) =>
  new Date(NOW + offsetMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const failed = (kind: ErrorKind, message: string, overrides: Partial<PollState> = {}) =>
  buildPollState({ lastError: { kind, message }, consecutiveFailures: 1, ...overrides });
const FETCHED = at(-minutes(14));

describe('describeStatus', () => {
  it('has nothing to say before the first poll or when all is well', () => {
    expect(describeStatus(undefined, FETCHED, 2, NOW)).toBeNull();
    expect(describeStatus(buildPollState(), at(-minutes(1)), 2, NOW)).toBeNull();
    expect(describeStatus(buildPollState(), at(-minutes(9)), 2, NOW)).toBeNull();
    expect(describeStatus(buildPollState({ inFlight: true }), undefined, 2, NOW)).toBeNull();
  });

  it('leaves the age out while the data is under a minute old', () => {
    const state = failed('server', 'x');
    expect(describeStatus(state, at(-30_000), 2, NOW)?.age).toBe('');
    expect(describeStatus(state, at(-minutes(1)), 2, NOW)?.age).toBe('Last updated 1 min ago.');
  });

  it('sends a rejected token to re-authentication, and says how old the list is', () => {
    expect(describeStatus(failed('unauthorized', 'Bad credentials'), FETCHED, 2, NOW)).toEqual({
      kind: 'unauthorized',
      tone: 'danger',
      title: 'Your GitHub token was revoked or expired',
      detail: 'Prowl stopped refreshing. Sign in again to continue.',
      age: 'Last updated 14 min ago.',
      action: { type: 'reauthenticate', label: 'Re-authenticate' },
    });
  });

  it('names the time a rate limit ends and offers no retry while it lasts', () => {
    const state = failed('rate_limited', 'API rate limit exceeded', {
      nextAllowedAt: at(minutes(20)),
    });
    expect(describeStatus(state, FETCHED, 2, NOW)).toMatchObject({
      kind: 'rate_limited',
      tone: 'warning',
      title: `Rate limited until ${clock(minutes(20))}`,
      action: null,
    });
  });

  it('offers a retry once the rate limit has reset', () => {
    const state = failed('rate_limited', 'x', { nextAllowedAt: at(-minutes(1)) });
    expect(describeStatus(state, FETCHED, 2, NOW)).toMatchObject({
      title: 'GitHub rate limit has reset',
      action: { type: 'retry' },
    });
  });

  it('counts the minutes to the next attempt when offline, rounding up', () => {
    const offline = (nextAllowedAt: string | null) =>
      describeStatus(
        failed('network', 'Could not reach GitHub.', { nextAllowedAt }),
        FETCHED,
        2,
        NOW,
      );
    expect(offline(at(minutes(3) - 1000))).toMatchObject({
      kind: 'offline',
      title: 'Offline — retrying in 3 min',
      detail: 'Could not reach GitHub.',
      action: { type: 'retry', label: 'Retry' },
    });
    expect(offline(at(5000))?.title).toBe('Offline — retrying in 1 min');
    // The wait is over (or there was none): the next alarm tries.
    expect(offline(at(-minutes(1)))?.title).toBe('Offline — retrying soon');
    expect(offline(null)?.title).toBe('Offline — retrying soon');
  });

  it.each<ErrorKind>(['server', 'graphql', 'forbidden', 'validation', 'not_found'])(
    'shows GitHub’s message for a %s error, with a retry',
    (kind) => {
      const state = failed(kind, 'Bad gateway', { nextAllowedAt: at(minutes(4)) });
      expect(describeStatus(state, undefined, 2, NOW)).toEqual({
        kind: 'error',
        tone: 'danger',
        title: 'GitHub error — retrying in 4 min',
        detail: 'Bad gateway',
        age: '',
        action: { type: 'retry', label: 'Retry' },
      });
    },
  );

  it('ignores a wait longer than an hour, which the clock going back would cause', () => {
    const state = failed('server', 'x', { nextAllowedAt: at(minutes(90)) });
    expect(describeStatus(state, FETCHED, 2, NOW)?.title).toBe('GitHub error — retrying soon');
  });

  it('marks data older than five poll intervals (at least ten minutes) as stale', () => {
    const stale = describeStatus(buildPollState(), at(-minutes(11)), 2, NOW);
    expect(stale).toMatchObject({
      kind: 'stale',
      title: 'Pull requests may be out of date',
      age: 'Last updated 11 min ago.',
      action: { type: 'retry', label: 'Refresh now' },
    });
    // A long interval allows a longer gap; a refresh in flight is not "stale" yet.
    expect(describeStatus(buildPollState(), at(-minutes(40)), 10, NOW)).toBeNull();
    expect(describeStatus(buildPollState(), at(-minutes(51)), 10, NOW)?.kind).toBe('stale');
    expect(describeStatus(buildPollState({ inFlight: true }), at(-minutes(60)), 2, NOW)).toBeNull();
  });

  it('explains a pause for a nearly used up budget, which is no error', () => {
    const state = buildPollState({
      nextAllowedAt: at(minutes(30)),
      rateLimit: { limit: 5000, remaining: 40, resetAt: at(minutes(30)) },
    });
    expect(describeStatus(state, FETCHED, 2, NOW)).toMatchObject({
      kind: 'rate_limited',
      title: 'GitHub rate limit almost used up',
      detail: `Refreshing resumes at ${clock(minutes(30))}.`,
      action: null,
    });
    // Plenty left: a wait would not be about the rate limit.
    const plenty = { ...state, rateLimit: { limit: 5000, remaining: 4000, resetAt: at(0) } };
    expect(describeStatus(plenty, at(-minutes(1)), 2, NOW)).toBeNull();
  });
});
