import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { headCommit, prId, prNode, searchResponse } from '../../tests/fixtures/github';
import { graphqlRateLimit, jsonResponse, rateLimitHeaders } from '../../tests/fixtures/http';
import type { AuthState, CheckState, PollState, Settings } from '../lib/model';
import { defaultSettings } from '../lib/storage/settings';
import { getItem, getItems, removeItems, setItem, setItems } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildAuth, buildPollState } from '../test/panel';
import { clearSignedOut, POLL_ALARM, poll, scheduleAlarm } from './poller';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const MINUTE = 60_000;
const at = (ms: number) => new Date(ms).toISOString();
const PR = prId(1);
const CHECKS: Record<CheckState, Record<string, number> | null> = {
  success: { SUCCESS: 2 },
  failure: { SUCCESS: 1, FAILURE: 1 },
  pending: { SUCCESS: 1, IN_PROGRESS: 1 },
  none: null,
};

type Reply = (query: string | undefined) => Response | object | Promise<Response | object>;

/** Stubs `fetch` as GitHub's GraphQL endpoint: every request gets `reply(search query)`. */
function github(reply: Reply = () => searchResponse([prNode()])) {
  const requests: { operation: string; query?: string; token: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body));
      const token = new Headers(init.headers).get('authorization');
      requests.push({
        operation: /query (\w+)/.exec(query)?.[1] ?? '',
        query: variables.query,
        token,
      });
      const out = await reply(variables.query);
      return out instanceof Response ? out : jsonResponse({ data: out });
    }),
  );
  return requests;
}

const fail =
  (status: number, message: string, headers: Record<string, string> = {}): Reply =>
  () =>
    jsonResponse({ message }, { status, headers });
const searchWith = (checks: CheckState) => () =>
  searchResponse([prNode({ commits: headCommit(CHECKS[checks]) })]);

const signIn = (auth: AuthState = buildAuth()) => setItem('auth', auth);
const pollState = async () => (await getItem('pollState')) as PollState;
const alarm = () => fakeChrome().__state.alarms.get(POLL_ALARM);
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('poll', () => {
  it('does nothing while signed out, and unschedules the alarm', async () => {
    const requests = github();
    await scheduleAlarm(2);
    expect(await poll()).toBeNull();
    expect(requests).toEqual([]);
    expect(alarm()).toBeUndefined();
    expect(await getItems(['snapshot', 'pollState'])).toEqual({});
  });

  it('fetches, stores the snapshot and the poll state, and schedules the alarm', async () => {
    const requests = github();
    await signIn();
    const result = await poll();

    expect(requests).toEqual([
      {
        operation: 'ProwlSearch',
        query: 'is:pr is:open author:@me archived:false sort:updated-desc',
        token: 'Bearer ghp_test',
      },
    ]);
    const { snapshot } = await getItems(['snapshot']);
    expect(snapshot).toMatchObject({
      fetchedAt: at(NOW),
      viewer: buildAuth().viewer,
      sections: { authored: [PR] },
      sectionErrors: {},
      settledChecks: {},
    });
    expect(Object.keys(snapshot?.pullRequests ?? {})).toEqual([PR]);
    expect(result).toEqual({ snapshot, events: [] });
    expect(await pollState()).toEqual({
      lastAttemptAt: at(NOW),
      lastSuccessAt: at(NOW),
      nextAllowedAt: null,
      consecutiveFailures: 0,
      rateLimit: { limit: 5000, remaining: 4990, resetAt: '2026-10-06T13:00:00.000Z' },
      lastError: null,
      inFlight: false,
    });
    expect(alarm()).toMatchObject({ periodInMinutes: 2, scheduledTime: NOW + 2 * MINUTE });
  });

  it('marks the poll in flight while it runs', async () => {
    let seen: PollState | undefined;
    github(async () => {
      seen = await getItem('pollState');
      return searchResponse([]);
    });
    await signIn();
    await poll();
    expect(seen).toMatchObject({ inFlight: true, lastAttemptAt: at(NOW) });
    expect(await pollState()).toMatchObject({ inFlight: false });
  });

  it('reports what changed since the previous poll, across pending checks', async () => {
    let checks: CheckState = 'failure';
    github(() => searchWith(checks)());
    await signIn();
    expect((await poll())?.events).toEqual([]);

    const types = async (next: CheckState) => {
      checks = next;
      later(2 * MINUTE);
      return (await poll())?.events.map(({ type }) => type);
    };
    expect(await types('pending')).toEqual([]);
    expect((await getItem('snapshot'))?.settledChecks).toEqual({ [PR]: 'failure' });
    expect(await types('success')).toEqual(['ci_passed']);
    expect(await types('pending')).toEqual([]);
    expect(await types('success')).toEqual([]);
    expect(await types('failure')).toEqual(['ci_failed']);
  });

  it('does not notify on the first poll after sign-in', async () => {
    github(searchWith('failure'));
    await signIn();
    expect(await poll()).toMatchObject({ events: [] });
  });

  it('takes no baseline from a snapshot of another account', async () => {
    const gone = prNode({ number: 2 });
    github(() => searchResponse([prNode({ commits: headCommit(CHECKS.failure) }), gone]));
    await signIn(buildAuth('hubot'));
    await poll();
    const requests = github(searchWith('success'));
    await signIn();
    // Would be ci_passed for the same account, and PR 2 would be looked up.
    expect(await poll()).toMatchObject({ events: [] });
    expect(requests.map(({ operation }) => operation)).toEqual(['ProwlSearch']);
    expect(Object.keys((await getItem('snapshot'))?.pullRequests ?? {})).toEqual([PR]);
  });

  it('shares one poll between concurrent triggers', async () => {
    const requests = github();
    await signIn();
    const polls = [poll(), poll({ force: true }), poll()];
    const [first, ...others] = await Promise.all(polls);
    expect(requests).toHaveLength(1);
    for (const other of others) expect(other).toBe(first);
    await poll();
    expect(requests).toHaveLength(2);
  });

  it('backs off exponentially after errors; a forced poll skips the backoff', async () => {
    const requests = github(fail(502, 'Bad gateway'));
    await signIn();
    await poll();
    expect(await pollState()).toMatchObject({
      consecutiveFailures: 1,
      nextAllowedAt: at(NOW + 4 * MINUTE),
      lastError: { kind: 'server', message: 'Bad gateway' },
      lastSuccessAt: null,
      inFlight: false,
    });
    expect(alarm()).toBeDefined();

    later(2 * MINUTE);
    await poll();
    expect(requests).toHaveLength(1);
    later(2 * MINUTE);
    await poll();
    expect(requests).toHaveLength(2);
    expect(await pollState()).toMatchObject({
      consecutiveFailures: 2,
      nextAllowedAt: at(NOW + 12 * MINUTE),
    });

    await poll({ force: true });
    expect(requests).toHaveLength(3);
    expect(await pollState()).toMatchObject({ consecutiveFailures: 3 });
  });

  it('caps the backoff at 30 minutes, with jitter', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    github(fail(502, 'Bad gateway'));
    await signIn();
    await setItem('pollState', buildPollState({ consecutiveFailures: 9 }));
    await poll();
    expect(await pollState()).toMatchObject({ nextAllowedAt: at(NOW + 26.25 * MINUTE) });
  });

  it('a success resets the failures', async () => {
    github();
    await signIn();
    await setItem(
      'pollState',
      buildPollState({ consecutiveFailures: 3, lastError: { kind: 'network', message: 'x' } }),
    );
    await poll();
    expect(await pollState()).toMatchObject({
      consecutiveFailures: 0,
      lastError: null,
      nextAllowedAt: null,
    });
  });

  it('waits for the rate limit to reset, even when forced', async () => {
    const reset = NOW + 20 * MINUTE;
    const requests = github(
      fail(403, 'API rate limit exceeded', rateLimitHeaders({ remaining: 0, reset: reset / 1000 })),
    );
    await signIn();
    await poll();
    expect(await pollState()).toMatchObject({
      nextAllowedAt: at(reset),
      lastError: { kind: 'rate_limited' },
    });

    later(10 * MINUTE);
    await poll({ force: true });
    expect(requests).toHaveLength(1);
    later(10 * MINUTE);
    github();
    await poll({ force: true });
    expect(await pollState()).toMatchObject({ lastError: null, nextAllowedAt: null });
  });

  it('waits for the reset when fewer than 100 points are left', async () => {
    const resetAt = at(NOW + 30 * MINUTE);
    const requests = github(() =>
      searchResponse([], {}, graphqlRateLimit({ remaining: 99, resetAt })),
    );
    await signIn();
    await poll();
    expect(await pollState()).toMatchObject({
      nextAllowedAt: resetAt,
      lastError: null,
      rateLimit: { remaining: 99 },
    });
    await poll({ force: true });
    expect(requests).toHaveLength(1);
  });

  it('stops on a rejected token until a forced poll', async () => {
    const requests = github(fail(401, 'Bad credentials'));
    await signIn();
    await poll();
    expect(await pollState()).toMatchObject({
      nextAllowedAt: null,
      lastError: { kind: 'unauthorized', message: 'Bad credentials' },
    });
    expect(alarm()).toBeUndefined();

    later(5 * MINUTE);
    await poll();
    expect(requests).toHaveLength(1);
    expect(alarm()).toBeUndefined();

    github();
    await poll({ force: true });
    expect(await pollState()).toMatchObject({ lastError: null });
    expect(alarm()).toBeDefined();
  });

  it('keeps sections GitHub refuses as section errors, without backing off', async () => {
    const custom = { id: 'custom-1', kind: 'custom', label: 'Mine', enabled: true, query: 'x' };
    await setItem('settings', {
      ...defaultSettings(),
      sections: [...defaultSettings().sections, custom],
    } as Settings);
    github((query) =>
      query?.startsWith('is:pr x')
        ? jsonResponse({ message: 'Validation Failed' }, { status: 422 })
        : searchResponse([prNode()]),
    );
    await signIn();
    await setItem('prLocal', { snoozed: {}, muted: { PR_elsewhere: true }, seen: {} });
    await poll();

    expect((await getItem('snapshot'))?.sectionErrors).toEqual({
      'custom-1': 'Validation Failed',
    });
    expect(await pollState()).toMatchObject({ consecutiveFailures: 0, lastError: null });
    expect((await getItem('prLocal'))?.muted).toEqual({ PR_elsewhere: true });
  });

  it('prunes local state of PRs that are gone and of ended snoozes', async () => {
    github();
    await signIn();
    await setItem('prLocal', {
      snoozed: { [PR]: at(NOW - MINUTE) },
      muted: { [PR]: true, PR_gone: true },
      seen: { PR_gone: at(NOW) },
    });
    await poll();
    expect(await getItem('prLocal')).toEqual({ snoozed: {}, muted: { [PR]: true }, seen: {} });
  });

  it('drops the result of a poll interrupted by sign-out', async () => {
    github(async () => {
      // The panel signs out mid-poll: removes its keys, then sends `signedOut`.
      await removeItems('auth', 'snapshot');
      await clearSignedOut();
      return searchResponse([prNode()]);
    });
    await signIn();
    expect(await poll()).toBeNull();
    expect(await getItems(['snapshot', 'pollState'])).toEqual({});
    expect(alarm()).toBeUndefined();
  });

  it('drops the error of a poll interrupted by sign-out', async () => {
    github(async () => {
      await removeItems('auth');
      return jsonResponse({ message: 'Bad credentials' }, { status: 401 });
    });
    await signIn();
    await poll();
    expect(await getItems(['pollState'])).toEqual({});
  });

  it('starts over when another account signs in mid-poll', async () => {
    const other = { ...buildAuth('hubot'), token: 'ghp_other' };
    let calls = 0;
    const requests = github(async () => {
      if (calls++ === 0) await signIn(other);
      return searchResponse([prNode()]);
    });
    await signIn();
    const result = await poll();
    expect(requests.map(({ token }) => token)).toEqual(['Bearer ghp_test', 'Bearer ghp_other']);
    expect(result?.snapshot.viewer.login).toBe('hubot');
  });

  it('clears an in-flight flag left by a worker that stopped mid-poll', async () => {
    const requests = github();
    await signIn();
    const stuck = buildPollState({
      inFlight: true,
      nextAllowedAt: at(NOW + MINUTE),
      lastError: { kind: 'network', message: 'x' },
    });
    await setItem('pollState', stuck);
    await poll();
    expect(requests).toEqual([]);
    expect(await pollState()).toEqual({ ...stuck, inFlight: false });
  });

  it('ignores a wait the clock cannot have set (it went back)', async () => {
    const requests = github();
    await signIn();
    await setItem(
      'pollState',
      buildPollState({
        nextAllowedAt: at(NOW + 24 * 60 * MINUTE),
        lastError: { kind: 'network', message: 'x' },
      }),
    );
    await poll();
    expect(requests).toHaveLength(1);
  });

  it('records an unexpected failure without the details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    github(() => searchResponse([{ ...prNode(), commits: null } as never]));
    await signIn();
    expect(await poll()).toBeNull();
    expect(await pollState()).toMatchObject({
      consecutiveFailures: 1,
      lastError: { kind: 'server', message: 'Something went wrong while refreshing.' },
    });
    expect(log).toHaveBeenCalled();
  });

  it('never rejects, even when storage fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('storage broken'));
    expect(await poll()).toBeNull();
    expect(log).toHaveBeenCalledWith('Prowl: poll failed', expect.any(Error));
  });
});

describe('scheduleAlarm', () => {
  it('creates the alarm, and replaces it only for a new period', async () => {
    await scheduleAlarm(2, true);
    expect(alarm()).toBeUndefined();
    await scheduleAlarm(2);
    expect(alarm()).toMatchObject({ periodInMinutes: 2 });
    later(MINUTE);
    await scheduleAlarm(2, true);
    expect(alarm()).toMatchObject({ scheduledTime: NOW + 2 * MINUTE });
    await scheduleAlarm(5, true);
    expect(alarm()).toMatchObject({ periodInMinutes: 5, scheduledTime: NOW + 6 * MINUTE });
  });
});

describe('clearSignedOut', () => {
  it('clears the alarm, the poll state, the badge and the notifications', async () => {
    await scheduleAlarm(2);
    await setItems({ auth: buildAuth(), pollState: buildPollState() });
    await chrome.action.setBadgeText({ text: '3' });
    await chrome.notifications.create('PR_1:ci_failed:a', {
      type: 'basic',
      title: 'x',
      message: 'y',
      iconUrl: 'i',
    });
    await clearSignedOut();
    expect(alarm()).toBeUndefined();
    expect(await getItems(['auth', 'pollState'])).toEqual({ auth: buildAuth() });
    expect(fakeChrome().__state.badge.text).toBe('');
    expect(fakeChrome().__state.notifications.size).toBe(0);
  });
});
