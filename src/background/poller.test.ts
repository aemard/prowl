import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  headCommit,
  mergeStateResponse,
  prId,
  prNode,
  searchResponse,
} from '../../tests/fixtures/github';
import { jsonResponse } from '../../tests/fixtures/http';
import type { CheckState, PollState } from '../lib/model';
import { defaultSettings } from '../lib/storage/settings';
import { getItem, getItems, removeItems, setItem, setItems } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildAuth, buildPollState } from '../test/panel';
import { clearSignedOut, poll, refreshMergeState, scheduleAlarm } from './poller';
import {
  alarm,
  at,
  CHECKS,
  github,
  later,
  MINUTE,
  NOW,
  PR,
  pollState,
  searchWith,
  signIn,
} from './poller.test-support';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

it('poll does nothing while signed out, and unschedules the alarm', async () => {
  const requests = github();
  await scheduleAlarm(2);
  expect(await poll()).toBeNull();
  expect(requests).toEqual([]);
  expect(alarm()).toBeUndefined();
  expect(await getItems(['snapshot', 'pollState'])).toEqual({});
});

it('poll fetches, stores the snapshot and the poll state, and schedules the alarm', async () => {
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
  expect(alarm()).toMatchObject({ periodInMinutes: 5, scheduledTime: NOW + 5 * MINUTE });
});

it('poll publishes search changes before a slow merge read and does not repeat their events', async () => {
  let checks: CheckState = 'pending';
  github(() => searchWith(checks)());
  await signIn();
  await setItem('settings', {
    ...defaultSettings(),
    notifications: { ...defaultSettings().notifications, enabled: true },
  });
  await poll();
  checks = 'failure';
  let reached = () => {};
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  github(
    () => searchWith(checks)(),
    undefined,
    (ids, nodes) =>
      new Promise((resolve) => {
        release = () => resolve(jsonResponse({ data: mergeStateResponse(ids, nodes) }));
        reached();
      }),
  );
  const loading = poll();
  await started;
  try {
    expect((await getItem('snapshot'))?.pullRequests[PR]?.checks.state).toBe('failure');
    expect(await pollState()).toMatchObject({ inFlight: true, mergePending: [PR] });
    expect(fakeChrome().__state.notifications.size).toBe(1);
  } finally {
    release();
  }
  const result = await loading;
  expect(result?.events.map(({ type }) => type)).toEqual(['ci_failed']);
  expect(fakeChrome().__state.notifications.size).toBe(1);
  expect(await pollState()).toMatchObject({ inFlight: false });
  expect(await pollState()).not.toHaveProperty('mergePending');
});

it('poll keeps the published list when merge enrichment fails and backs off', async () => {
  github(undefined, undefined, () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
  await signIn();
  expect(await poll()).toBeNull();
  expect((await getItem('snapshot'))?.sections.authored).toEqual([PR]);
  expect(await pollState()).toMatchObject({
    inFlight: false,
    lastError: { kind: 'unauthorized' },
  });
  expect(alarm()).toBeUndefined();
  expect(await pollState()).not.toHaveProperty('mergePending');
});

it('poll does not restore a progressively published list after sign-out during enrichment', async () => {
  github(undefined, undefined, async (ids, nodes) => {
    expect((await getItem('snapshot'))?.sections.authored).toEqual([PR]);
    await removeItems('auth', 'snapshot');
    return jsonResponse({ data: mergeStateResponse(ids, nodes) });
  });
  await signIn();
  expect(await poll()).toBeNull();
  expect(await getItems(['snapshot', 'pollState'])).toEqual({});
});

it('poll prioritizes an opened PR in the next batch without a redundant targeted read', async () => {
  const nodes = Array.from({ length: 25 }, (_, i) =>
    prNode({ number: i + 1, mergeStateStatus: 'CLEAN' }),
  );
  let opened: Promise<void> | undefined;
  const batches: string[][] = [];
  github(
    () => searchResponse(nodes),
    undefined,
    async (ids, found) => {
      batches.push(ids);
      if (batches.length === 1) {
        opened = refreshMergeState(prId(25), 'a'.repeat(40));
        // Let the open request register its priority while this batch is in flight.
        await Promise.resolve();
        await Promise.resolve();
      }
      return jsonResponse({ data: mergeStateResponse(ids, found) });
    },
  );
  await signIn();
  await poll();
  await opened;
  expect(batches).toHaveLength(2);
  expect(batches[1]?.[0]).toBe(prId(25));
});

it('poll marks the poll in flight while it runs', async () => {
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

it('poll takes no baseline from a snapshot of another account', async () => {
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

it('poll shares one poll between concurrent triggers', async () => {
  const requests = github();
  await signIn();
  const polls = [poll(), poll({ force: true }), poll()];
  const [first, ...others] = await Promise.all(polls);
  expect(requests).toHaveLength(1);
  for (const other of others) expect(other).toBe(first);
  await poll();
  expect(requests).toHaveLength(2);
});

it('scheduleAlarm creates the alarm, and replaces it only for a new period', async () => {
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

it('clearSignedOut clears the alarm, the poll state, the badge and the notifications', async () => {
  await scheduleAlarm(2);
  await setItems({ auth: buildAuth(), pollState: buildPollState() });
  await chrome.action.setBadgeText({ text: '3' });
  await chrome.storage.session.set({
    notified: { 'PR_1:ci_failed:a': 'https://github.com/a/b/pull/1' },
  });
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
  expect(await chrome.storage.session.get('notified')).toEqual({});
});
