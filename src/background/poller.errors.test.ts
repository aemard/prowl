import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prNode, searchResponse } from '../../tests/fixtures/github';
import { graphqlRateLimit, jsonResponse, rateLimitHeaders } from '../../tests/fixtures/http';
import type { Settings } from '../lib/model';
import { defaultSettings } from '../lib/storage/settings';
import { getItem, getItems, removeItems, setItem } from '../lib/storage/storage';
import { buildAuth, buildPollState } from '../test/panel';
import { clearSignedOut, poll } from './poller';
import {
  alarm,
  at,
  fail,
  github,
  later,
  MINUTE,
  NOW,
  PR,
  pollState,
  signIn,
} from './poller.test-support';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

it('poll backs off exponentially after errors; a forced poll skips the backoff', async () => {
  const requests = github(fail(502, 'Bad gateway'));
  await signIn();
  await setItem('settings', { ...defaultSettings(), pollIntervalMinutes: 2 });
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

it('poll caps the backoff at 30 minutes, with jitter', async () => {
  vi.mocked(Math.random).mockReturnValue(0.5);
  github(fail(502, 'Bad gateway'));
  await signIn();
  await setItem('pollState', buildPollState({ consecutiveFailures: 9 }));
  await poll();
  expect(await pollState()).toMatchObject({ nextAllowedAt: at(NOW + 26.25 * MINUTE) });
});

it('poll a success resets the failures', async () => {
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

it('poll waits for the rate limit to reset, even when forced', async () => {
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

it('poll waits for the reset when fewer than 100 points are left', async () => {
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

it('poll stops on a rejected token until a forced poll', async () => {
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

it('poll keeps sections GitHub refuses as section errors, without backing off', async () => {
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

it('poll prunes local state of PRs that are gone and of ended snoozes', async () => {
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

it('poll drops the result of a poll interrupted by sign-out', async () => {
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

it('poll drops the error of a poll interrupted by sign-out', async () => {
  github(async () => {
    await removeItems('auth');
    return jsonResponse({ message: 'Bad credentials' }, { status: 401 });
  });
  await signIn();
  await poll();
  expect(await getItems(['pollState'])).toEqual({});
});

it('poll starts over when another account signs in mid-poll', async () => {
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

it('poll clears an in-flight flag left by a worker that stopped mid-poll', async () => {
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

it('poll ignores a wait the clock cannot have set (it went back)', async () => {
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

it('poll records an unexpected failure without the details', async () => {
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

it('poll never rejects, even when storage fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('storage broken'));
  expect(await poll()).toBeNull();
  expect(log).toHaveBeenCalledWith('Prowl: poll failed', expect.any(Error));
});
