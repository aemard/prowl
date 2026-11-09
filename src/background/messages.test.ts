import { describe, expect, it, vi } from 'vitest';
import { prId, searchResponse, teamJson } from '../../tests/fixtures/github';
import { jsonResponse } from '../../tests/fixtures/http';
import { activityKey } from '../lib/activity';
import { getItem, getItems, setItems } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildAuth, buildPollState, buildPullRequest, buildSnapshot } from '../test/panel';
import { handleMessage } from './messages';
import { POLL_ALARM, scheduleAlarm } from './poller';

/** Delivers `message` and resolves once it is answered; false when the router ignored it. */
function send(
  message: unknown,
  sender: chrome.runtime.MessageSender = { id: chrome.runtime.id },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!handleMessage(message, sender, () => resolve(true))) resolve(false);
  });
}

describe('handleMessage', () => {
  it('rejects malformed trailing-refresh flags', async () => {
    expect(await send({ type: 'poll', afterCurrent: 'true' })).toBe(false);
  });

  it('ignores other extensions and messages it does not know', async () => {
    const other = { id: 'someone-else' } as chrome.runtime.MessageSender;
    expect(await send({ type: 'signedOut' }, other)).toBe(false);
    for (const message of [
      null,
      'poll',
      { type: 'nope' },
      { type: 'poll', force: 'yes' },
      { type: 'markSeen', prIds: 'PR_1' },
      { type: 'markSeen', prIds: [1] },
      { type: 'markSeen', prIds: [], versions: { PR_1: 5 } },
      { type: 'refreshMergeState', prId: '', headSha: 'a'.repeat(40) },
      { type: 'refreshMergeState', prId: 'PR_1', headSha: 'bad' },
      { type: 'refreshMergeState', prId: 1, headSha: 'a'.repeat(40) },
    ])
      expect(await send(message)).toBe(false);
  });

  it('runs a forced poll and answers once it is done', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await setItems({
      auth: buildAuth(),
      pollState: buildPollState({
        consecutiveFailures: 1,
        lastError: { kind: 'unauthorized', message: 'x' },
      }),
    });
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await send({ type: 'poll', force: true })).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(await getItem('pollState')).toMatchObject({ lastError: { kind: 'network' } });

    expect(await send({ type: 'poll' })).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('discovers the teams again on request, then polls', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes('/user/teams?')
        ? jsonResponse([teamJson('acme/core', 'Core')])
        : jsonResponse({ data: searchResponse([]) }),
    );
    vi.stubGlobal('fetch', fetch);
    const fresh = { login: 'octocat', fetchedAt: new Date().toISOString(), teams: [], error: null };
    await setItems({ auth: buildAuth(), teams: fresh });

    expect(await send({ type: 'refreshTeams' })).toBe(true);
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/user/teams',
      '/graphql',
      '/graphql',
    ]);
    expect((await getItem('teams'))?.teams).toEqual([{ org: 'acme', slug: 'core', name: 'Core' }]);
  });

  it('marks the snapshot version of PRs seen', async () => {
    const snapshot = buildSnapshot();
    const id = prId(1);
    const pr = buildPullRequest({ id, updatedAt: '2026-10-06T10:00:00Z' });
    snapshot.pullRequests[id] = pr;
    await setItems({ auth: buildAuth(), snapshot });
    expect(
      await send({
        type: 'markSeen',
        prIds: [id, 'PR_unknown'],
        versions: { [id]: { updatedAt: pr.updatedAt, facts: activityKey(pr) } },
      }),
    ).toBe(true);
    expect((await getItem('prLocal'))?.seen).toEqual({ [id]: '2026-10-06T10:00:00Z' });
  });

  it('marks a PR seen only at the version the panel showed', async () => {
    const snapshot = buildSnapshot();
    const pr = buildPullRequest();
    snapshot.pullRequests[pr.id] = pr;
    await setItems({ auth: buildAuth(), snapshot });
    await send({
      type: 'markSeen',
      prIds: [pr.id],
      versions: { [pr.id]: { updatedAt: pr.updatedAt, facts: 'older version' } },
    });
    expect((await getItem('prLocal'))?.seen).toEqual({});
    await send({
      type: 'markSeen',
      prIds: [pr.id],
      versions: { [pr.id]: { updatedAt: pr.updatedAt, facts: activityKey(pr) } },
    });
    expect((await getItem('prLocal'))?.seenFacts?.[pr.id]).toBe(activityKey(pr));
  });

  it('never marks newer activity seen from an older viewing interval', async () => {
    const snapshot = buildSnapshot();
    const observed = buildPullRequest({ updatedAt: '2026-10-06T10:00:00Z' });
    const latest = { ...observed, updatedAt: '2026-10-06T11:00:00Z' };
    snapshot.pullRequests[latest.id] = latest;
    await setItems({ auth: buildAuth(), snapshot });
    await send({
      type: 'markSeen',
      prIds: [observed.id],
      versions: {
        [observed.id]: { updatedAt: observed.updatedAt, facts: activityKey(observed) },
      },
    });
    expect((await getItem('prLocal'))?.seen).toEqual({});
    await send({
      type: 'markSeen',
      prIds: [latest.id],
      versions: {
        [latest.id]: { updatedAt: observed.updatedAt, facts: activityKey(latest) },
      },
    });
    expect((await getItem('prLocal'))?.seen).toEqual({});
    expect(await send({ type: 'markSeen', prIds: [latest.id] })).toBe(false);
    expect(
      await send({
        type: 'markSeen',
        prIds: [latest.id],
        versions: {
          [latest.id]: { updatedAt: 'invalid', facts: activityKey(latest) },
        },
      }),
    ).toBe(false);
  });

  it('marks nothing seen when signed out or when the snapshot belongs to another account', async () => {
    const snapshot = buildSnapshot();
    const pr = buildPullRequest();
    snapshot.pullRequests[pr.id] = pr;
    await setItems({ snapshot });
    await send({
      type: 'markSeen',
      prIds: [pr.id],
      versions: { [pr.id]: { updatedAt: pr.updatedAt, facts: activityKey(pr) } },
    });
    await setItems({ auth: buildAuth('hubot') });
    await send({
      type: 'markSeen',
      prIds: [pr.id],
      versions: { [pr.id]: { updatedAt: pr.updatedAt, facts: activityKey(pr) } },
    });
    expect(await getItem('prLocal')).toBeUndefined();
  });

  it('stops polling and clears the badge on sign-out', async () => {
    await scheduleAlarm(2);
    await setItems({ pollState: buildPollState() });
    await chrome.action.setBadgeText({ text: '3' });
    expect(await send({ type: 'signedOut' })).toBe(true);
    expect(fakeChrome().__state.alarms.has(POLL_ALARM)).toBe(false);
    expect(await getItems(['pollState'])).toEqual({});
    expect(fakeChrome().__state.badge.text).toBe('');
  });

  it('answers even when handling fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('storage broken'));
    expect(await send({ type: 'markSeen', prIds: [], versions: {} })).toBe(true);
    expect(log).toHaveBeenCalledWith('Prowl: message failed', expect.any(Error));
  });
});
