import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../tests/fixtures/http';
import { notificationThread } from '../../tests/fixtures/notifications';
import type { CheckSummary } from '../lib/model';
import { getItem, setItem } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildAuth, buildPollState, buildPullRequest, buildSnapshotOf } from '../test/panel';
import { checkFastLane, onChromeFocused } from './fastLane';
import { poll } from './poller';
import { INBOX_ALARM, POLL_ALARM, scheduleAlarms } from './pollState';

vi.mock('./poller', async (original) => ({
  ...(await original<typeof import('./poller')>()),
  poll: vi.fn(async () => null),
}));

const LAST = 'Thu, 05 Nov 2026 10:00:00 GMT';
const LATER = 'Thu, 05 Nov 2026 10:05:00 GMT';
const UPDATED = '2026-11-05T10:04:00Z';
const MINUTE = 60_000;
const VIEWER = { login: 'octocat', avatarUrl: '', isBot: false };
let answer: () => Response;
const fetch = vi.fn(async () => answer());
const inbox = async () =>
  (await chrome.storage.session.get<{ inbox?: Record<string, unknown> }>('inbox')).inbox;
const alarms = () => [...fakeChrome().__state.alarms.keys()].sort();
const prThread = (updatedAt: string, reason?: string) =>
  notificationThread({ updatedAt, reason, repo: 'watched/repo' });
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  vi.stubGlobal('fetch', fetch);
  fetch.mockClear();
  vi.mocked(poll).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('checkFastLane: the inbox', () => {
  it('does nothing signed out or with a fine-grained token', async () => {
    await checkFastLane();
    await setItem('auth', { ...buildAuth(), tokenType: 'fine_grained' });
    await checkFastLane();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for an inbox poll when a pull request thread was updated since the last check', async () => {
    await setItem('auth', buildAuth());
    answer = () => jsonResponse([prThread(UPDATED)], { headers: { 'last-modified': LAST } });
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();
    expect(await inbox()).toMatchObject({ lastModified: LAST });

    answer = () => new Response(null, { status: 304 });
    await checkFastLane(Date.now() + MINUTE);
    expect(poll).not.toHaveBeenCalled();

    answer = () => jsonResponse([prThread(UPDATED)], { headers: { 'last-modified': LATER } });
    await checkFastLane(Date.now() + 2 * MINUTE);
    expect(poll).toHaveBeenCalledWith({ reason: 'inbox' });
  });

  it('never polls for old unread pull request threads a change elsewhere sent back', async () => {
    await setItem('auth', buildAuth());
    await chrome.storage.session.set({ inbox: { lastModified: LAST } });
    const old = '2026-11-01T08:00:00Z';
    answer = () =>
      jsonResponse([{ subject: { type: 'Issue' }, updated_at: UPDATED }, prThread(old)], {
        headers: { 'last-modified': LATER },
      });
    for (let minute = 0; minute < 5; minute++) await checkFastLane(Date.now() + minute * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(poll).not.toHaveBeenCalled();
  });

  it("asks no more often than GitHub's X-Poll-Interval, counted from the alarm's due time", async () => {
    await setItem('auth', buildAuth());
    const due = Date.now();
    answer = () =>
      new Response(null, {
        status: 304,
        headers: { 'x-poll-interval': '120', 'last-modified': LAST },
      });
    await checkFastLane(due);
    await checkFastLane(due + MINUTE);
    expect(fetch).toHaveBeenCalledTimes(1);
    await checkFastLane(due + 2 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await inbox()).toMatchObject({ nextAt: new Date(due + 4 * MINUTE).toISOString() });
    // A wait stored before the clock went back by hours does not stall the lane.
    await checkFastLane(due - 5 * 60 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('polls for a watched repository’s thread only when the list shows that repository', async () => {
    await setItem('auth', buildAuth());
    await chrome.storage.session.set({ inbox: { lastModified: LAST } });
    answer = () =>
      jsonResponse([prThread(UPDATED, 'subscribed')], { headers: { 'last-modified': LAST } });
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();
    const listed = buildPullRequest({
      repo: { owner: 'watched', name: 'repo', nameWithOwner: 'watched/repo' },
    });
    await setItem('snapshot', buildSnapshotOf({ mine: [listed] }, { fetchedAt: ago(MINUTE) }));
    await checkFastLane(Date.now() + MINUTE);
    expect(poll).toHaveBeenCalledWith({ reason: 'inbox' });
  });

  it('leaves the inbox unread for a list under a minute old, so its news waits', async () => {
    await setItem('auth', buildAuth());
    await chrome.storage.session.set({ inbox: { lastModified: LAST } });
    await setItem('snapshot', buildSnapshotOf({}, { fetchedAt: ago(30_000) }));
    await checkFastLane();
    expect(fetch).not.toHaveBeenCalled();
    expect(await inbox()).toEqual({ lastModified: LAST });
    await setItem('snapshot', buildSnapshotOf({}, { fetchedAt: ago(MINUTE) }));
    answer = () => jsonResponse([prThread(UPDATED)], { headers: { 'last-modified': LATER } });
    await checkFastLane();
    expect(poll).toHaveBeenCalledWith({ reason: 'inbox' });
  });

  it('stops asking for the session when the token cannot read the inbox', async () => {
    await setItem('auth', buildAuth());
    answer = () => jsonResponse({ message: 'Resource not accessible' }, { status: 403 });
    await checkFastLane();
    expect(await inbox()).toEqual({ lastModified: null, off: true });
    await checkFastLane();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('checkFastLane: the cadence policy', () => {
  it('stops polling and both alarms on a rejected token', async () => {
    await setItem('auth', buildAuth());
    await scheduleAlarms(2);
    answer = () => jsonResponse({ message: 'Bad credentials' }, { status: 401 });
    await checkFastLane();
    expect(await getItem('pollState')).toMatchObject({ lastError: { kind: 'unauthorized' } });
    expect(alarms()).toEqual([]);
    await checkFastLane();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(poll).not.toHaveBeenCalled();
  });

  it('clears an inbox alarm that outlived a rejected token, asking GitHub nothing', async () => {
    await setItem('auth', buildAuth());
    await setItem(
      'pollState',
      buildPollState({ lastError: { kind: 'unauthorized', message: 'x' } }),
    );
    await chrome.alarms.create(INBOX_ALARM, { periodInMinutes: 1 });
    await checkFastLane();
    expect(fetch).not.toHaveBeenCalled();
    expect(alarms()).toEqual([]);
  });

  it('asks GitHub nothing during a backoff or a rate-limit wait', async () => {
    await setItem('auth', buildAuth());
    const until = new Date(Date.now() + 10 * MINUTE).toISOString();
    for (const kind of ['network', 'rate_limited'] as const) {
      await setItem(
        'pollState',
        buildPollState({ nextAllowedAt: until, lastError: { kind, message: 'x' } }),
      );
      await checkFastLane();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    expect(alarms()).not.toContain(POLL_ALARM);
  });

  it('backs off only the lane on a REST rate limit: GraphQL polls have their own budget', async () => {
    await setItem('auth', buildAuth());
    const due = Date.now();
    answer = () =>
      jsonResponse({ message: 'rate limit' }, { status: 429, headers: { 'retry-after': '600' } });
    await checkFastLane(due);
    expect(await getItem('pollState')).toBeUndefined();
    expect(Date.parse(String((await inbox())?.nextAt))).toBeGreaterThanOrEqual(due + 10 * MINUTE);
    await checkFastLane(due + 5 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(1);
    await checkFastLane(due + 11 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last Last-Modified through a rate limit, so the next check stays conditional', async () => {
    await setItem('auth', buildAuth());
    await chrome.storage.session.set({ inbox: { lastModified: LAST } });
    answer = () => jsonResponse({ message: 'API rate limit exceeded' }, { status: 403 });
    await checkFastLane();
    expect(await inbox()).toMatchObject({ lastModified: LAST });
    expect(await getItem('pollState')).toBeUndefined();
  });
});

describe('checkFastLane: the CI watch', () => {
  const checks = (running: number): CheckSummary => ({
    state: 'pending',
    total: 2,
    passed: 0,
    failed: 0,
    pending: 2,
    running,
    neutral: 0,
  });
  const seed = (pr: Parameters<typeof buildPullRequest>[0]) =>
    setItem(
      'snapshot',
      buildSnapshotOf(
        { authored: [buildPullRequest({ author: VIEWER, ...pr })] },
        { fetchedAt: ago(2 * MINUTE) },
      ),
    );

  beforeEach(() => setItem('auth', { ...buildAuth(), tokenType: 'fine_grained' }));

  it('asks for a CI poll while CI runs on a recently changed PR, for every token type', async () => {
    await seed({ checks: checks(1), updatedAt: ago(5 * MINUTE), lastCommitAt: ago(5 * MINUTE) });
    await checkFastLane();
    expect(poll).toHaveBeenCalledWith({ reason: 'ci' });
  });

  it('never polls every minute for checks that only wait (EXPECTED, WAITING)', async () => {
    await seed({ checks: checks(0), updatedAt: ago(5 * MINUTE), lastCommitAt: ago(5 * MINUTE) });
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();
  });

  it("leaves CI on other people's pull requests to the scheduled poll", async () => {
    const author = { login: 'alice', avatarUrl: '', isBot: false };
    await seed({ author, checks: checks(1), updatedAt: ago(MINUTE), lastCommitAt: ago(MINUTE) });
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();
  });

  it('stops watching an hour after the pull request last changed', async () => {
    await seed({
      checks: checks(1),
      updatedAt: ago(61 * MINUTE),
      lastCommitAt: ago(3 * 24 * 60 * MINUTE),
    });
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();
  });
});

describe('onChromeFocused', () => {
  it('asks for a focus poll when a Chrome window gets focus', async () => {
    await onChromeFocused(chrome.windows.WINDOW_ID_NONE);
    expect(poll).not.toHaveBeenCalled();
    await onChromeFocused(1);
    expect(poll).toHaveBeenCalledWith({ reason: 'focus' });
  });
});
