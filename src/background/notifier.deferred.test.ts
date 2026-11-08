import { afterEach, expect, it, vi } from 'vitest';
import { prEvent } from '../../tests/fixtures/events';
import { emptyPrLocal, mute, snooze } from '../lib/storage/prLocal';
import { defaultSettings } from '../lib/storage/settings';
import { fakeChrome } from '../test/chrome';
import { forgetNotified, notifyEvents } from './notifier';

const settings = () => ({
  ...defaultSettings().notifications,
  enabled: true,
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
});
const events = (count = 1) => Array.from({ length: count }, (_, i) => prEvent({ number: i + 1 }));
const pending = async () =>
  (await chrome.storage.local.get('deferredNotifications')).deferredNotifications;
const time = (hour: number) => vi.setSystemTime(new Date(2026, 9, 6, hour));
async function defer(count = 1) {
  vi.useFakeTimers({ toFake: ['Date'] });
  time(23);
  const batch = events(count);
  await chrome.storage.local.set({
    snapshot: { pullRequests: Object.fromEntries(batch.map((e) => [e.prId, { state: 'open' }])) },
  });
  await notifyEvents(batch, settings(), emptyPrLocal());
  return batch;
}
afterEach(() => vi.useRealTimers());

it('persists quiet events and delivers once on an empty morning pass after a module restart', async () => {
  const batch = await defer();
  expect(await pending()).toEqual(batch);
  expect(fakeChrome().__state.notifications.size).toBe(0);
  vi.resetModules();
  time(8);
  const worker = await import('./notifier');
  await worker.notifyEvents([], settings(), emptyPrLocal());
  expect([...fakeChrome().__state.notifications.keys()]).toEqual([batch[0]?.id]);
  expect(await pending()).toEqual([]);
  fakeChrome().__state.notifications.clear();
  await worker.notifyEvents([], settings(), emptyPrLocal());
  expect(fakeChrome().__state.notifications.size).toBe(0);
});

it('dedupes, bounds the queue to the newest 50 and summarizes delivery', async () => {
  const batch = await defer(55);
  await notifyEvents(batch, settings(), emptyPrLocal());
  expect(await pending()).toEqual(batch.slice(-50));
  time(8);
  await notifyEvents([], settings(), emptyPrLocal());
  expect(fakeChrome().__state.notifications.size).toBe(1);
  expect([...fakeChrome().__state.notifications.values()][0]?.options.title).toBe(
    '50 pull request updates',
  );
});

it.each(['missing', 'closed', 'merged', 'muted', 'snoozed', 'type', 'disabled'])(
  'drops pending events when delivery is blocked by %s',
  async (reason) => {
    const [event] = await defer();
    if (!event) throw new Error('missing fixture');
    if (['missing', 'closed', 'merged'].includes(reason)) {
      await chrome.storage.local.set({
        snapshot: { pullRequests: reason === 'missing' ? {} : { [event.prId]: { state: reason } } },
      });
    }
    time(8);
    let local = emptyPrLocal();
    if (reason === 'muted') local = mute(local, event.prId);
    if (reason === 'snoozed') local = snooze(local, event.prId, Date.now() + 3600000);
    const config = settings();
    if (reason === 'type') config.events.ci_failed = false;
    if (reason === 'disabled') config.enabled = false;
    await notifyEvents([], config, local);
    expect(fakeChrome().__state.notifications.size).toBe(0);
    expect(await pending()).toEqual([]);
  },
);

it('queues only events otherwise eligible and clears deferred events on sign-out', async () => {
  const batch = await defer();
  await forgetNotified();
  expect(await pending()).toBeUndefined();
  await notifyEvents(batch, settings(), mute(emptyPrLocal(), batch[0]?.prId ?? ''));
  expect((await pending()) ?? []).toEqual([]);
});

it('retains the backlog when notification creation fails, then retries it', async () => {
  const batch = await defer();
  time(8);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const create = vi
    .spyOn(chrome.notifications, 'create')
    .mockRejectedValueOnce(new Error('display'));
  await notifyEvents([], settings(), emptyPrLocal());
  expect(await pending()).toEqual(batch);
  expect(log).toHaveBeenCalledOnce();
  await notifyEvents([], settings(), emptyPrLocal());
  expect(create).toHaveBeenCalledTimes(2);
  expect(await pending()).toEqual([]);
});
