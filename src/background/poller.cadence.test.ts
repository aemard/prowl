/** Each trigger through the real poller: the cadence policy decides, the same for all. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollReason } from '../lib/model';
import { setItem } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildPollState } from '../test/panel';
import { poll } from './poller';
import { fail, github, later, MINUTE, NOW, pollState, signIn } from './poller.test-support';
import { INBOX_ALARM, POLL_ALARM, scheduleAlarms } from './pollState';

const alarms = () => fakeChrome().__state.alarms;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => vi.useRealTimers());

describe('poll reasons', () => {
  it('a panel opening during a backoff asks GitHub nothing; an explicit Refresh does', async () => {
    const requests = github(fail(502, 'Bad gateway'));
    await signIn();
    await poll({ reason: 'user' });
    expect(await pollState()).toMatchObject({ lastError: { kind: 'server' } });
    for (const reason of ['panel', 'focus', 'inbox', 'ci', 'schedule'] as PollReason[])
      expect(await poll({ reason })).toBeNull();
    expect(requests).toHaveLength(1);
    github();
    await poll({ reason: 'user' });
    expect(await pollState()).toMatchObject({ lastError: null });
  });

  it('the panel polls a list older than a minute, focus one older than the interval', async () => {
    const requests = github();
    await signIn();
    await poll({ reason: 'startup' });
    expect(requests).toHaveLength(1);
    later(30_000);
    await poll({ reason: 'panel' });
    await poll({ reason: 'focus' });
    expect(requests).toHaveLength(1);
    later(MINUTE);
    await poll({ reason: 'panel' });
    expect(requests).toHaveLength(2);
    await poll({ reason: 'focus' });
    expect(requests).toHaveLength(2);
    later(2 * MINUTE);
    await poll({ reason: 'focus' });
    expect(requests).toHaveLength(3);
  });

  it('the poll alarm right after a CI-watch poll asks GitHub nothing, then polls as usual', async () => {
    const requests = github();
    await signIn();
    await poll({ reason: 'schedule' });
    later(110_000);
    await poll({ reason: 'ci' });
    later(10_000);
    await poll({ reason: 'schedule' });
    expect(requests).toHaveLength(2);
    later(2 * MINUTE);
    await poll({ reason: 'schedule' });
    expect(requests).toHaveLength(3);
  });

  it('no reason polls through a rate-limit wait, not even an explicit one', async () => {
    const requests = github();
    await signIn();
    const until = new Date(NOW + 10 * MINUTE).toISOString();
    await setItem(
      'pollState',
      buildPollState({ nextAllowedAt: until, lastError: { kind: 'rate_limited', message: 'x' } }),
    );
    for (const reason of ['panel', 'user', 'change', 'inbox'] as PollReason[])
      await poll({ reason });
    expect(requests).toEqual([]);
  });

  it('inbox news during a poll gets one trailing poll; a CI tick shares the one in flight', async () => {
    const requests = github();
    await signIn();
    const first = poll({ reason: 'schedule' });
    const ci = poll({ reason: 'ci' });
    const inbox = [poll({ reason: 'inbox' }), poll({ reason: 'inbox' })];
    expect(ci).toBe(first);
    expect(inbox[0]).toBe(inbox[1]);
    await Promise.all([first, ...inbox]);
    expect(requests).toHaveLength(2);
  });
});

describe('alarms', () => {
  it('a rejected token clears both alarms', async () => {
    github(fail(401, 'Bad credentials'));
    await signIn();
    await scheduleAlarms(2);
    await poll({ reason: 'schedule' });
    expect([...alarms().keys()]).toEqual([]);
  });

  it('an upgrade with only the poll alarm gets the inbox alarm, the poll alarm keeps its place', async () => {
    await chrome.alarms.create(POLL_ALARM, { delayInMinutes: 2, periodInMinutes: 2 });
    later(MINUTE);
    github();
    await signIn();
    await poll({ reason: 'startup' });
    expect(alarms().get(INBOX_ALARM)).toMatchObject({ periodInMinutes: 1 });
    expect(alarms().get(POLL_ALARM)).toMatchObject({ scheduledTime: NOW + 2 * MINUTE });
  });

  it('a settings change while stopped schedules neither alarm', async () => {
    await scheduleAlarms(5, true);
    expect(alarms().size).toBe(0);
  });
});
