import { describe, expect, it, vi } from 'vitest';
import { prId } from '../../tests/fixtures/github';
import type { PullRequest } from '../lib/model';
import { getItem, getItems, setItems } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildAuth, buildPollState, buildSnapshot } from '../test/panel';
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

  it('marks the snapshot version of PRs seen', async () => {
    const snapshot = buildSnapshot();
    const id = prId(1);
    snapshot.pullRequests[id] = { id, updatedAt: '2026-10-06T10:00:00Z' } as PullRequest;
    await setItems({ snapshot });
    expect(await send({ type: 'markSeen', prIds: [id, 'PR_unknown'] })).toBe(true);
    expect((await getItem('prLocal'))?.seen).toEqual({ [id]: '2026-10-06T10:00:00Z' });
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
    expect(await send({ type: 'markSeen', prIds: [] })).toBe(true);
    expect(log).toHaveBeenCalledWith('Prowl: message failed', expect.any(Error));
  });
});
