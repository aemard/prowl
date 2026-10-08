import { describe, expect, it, vi } from 'vitest';
import { prEvent } from '../../tests/fixtures/events';
import type { PrLocalState } from '../lib/model';
import { emptyPrLocal, mute } from '../lib/storage/prLocal';
import { defaultSettings } from '../lib/storage/settings';
import { fakeChrome } from '../test/chrome';
import {
  forgetNotified,
  notifyEvents,
  onNotificationButtonClicked,
  onNotificationClicked,
} from './notifier';

const settings = () => defaultSettings().notifications;
const shown = () => fakeChrome().__state.notifications;
const notify = (...events: ReturnType<typeof prEvent>[]) =>
  notifyEvents(events, settings(), emptyPrLocal());
const events = (count: number) =>
  Array.from({ length: count }, (_, i) => prEvent({ number: i + 1 }));
const stored = async () =>
  (await chrome.storage.session.get<{ notified?: Record<string, string> }>('notified')).notified;

describe('notifyEvents', () => {
  it('shows one notification per event, with the event id as id', async () => {
    const [failed, approved] = [
      prEvent(),
      prEvent({ type: 'approved', actor: 'hubot', number: 2 }),
    ];
    await notify(failed, approved);
    expect([...shown().keys()]).toEqual([failed.id, approved.id]);
    expect(shown().get(approved.id)?.options).toEqual({
      type: 'basic',
      iconUrl: 'chrome-extension://prowl-test-extension/icons/icon-128.png',
      title: 'hubot approved',
      message: 'Improve widget 2',
      contextMessage: 'acme/widgets#2',
      buttons: [{ title: 'Open' }, { title: 'Snooze 1 h' }],
    });
  });

  it('shows three events separately and more than three as one summary', async () => {
    await notify(...events(3));
    expect(shown().size).toBe(3);
    shown().clear();

    await notify(...events(7).map((e) => ({ ...e, id: `${e.id}:2` })));
    expect([...shown().keys()]).toEqual([expect.stringMatching(/^summary:\d+$/)]);
    expect([...shown().values()][0]?.options.buttons).toBeUndefined();
    expect([...shown().values()][0]?.options).toMatchObject({
      title: '7 pull request updates',
      message: 'acme/widgets#1, acme/widgets#2, acme/widgets#3 and 4 more',
    });
  });

  it('reports an event once, even across calls and worker restarts', async () => {
    const [first, second] = events(2) as [ReturnType<typeof prEvent>, ReturnType<typeof prEvent>];
    await notify(first);
    shown().clear();
    await notify(first, second);
    expect([...shown().keys()]).toEqual([second.id]);
    await notify(first, second);
    expect(shown().size).toBe(1);
  });

  it('reports the events of a summary once as well', async () => {
    await notify(...events(5));
    shown().clear();
    await notify(...events(5));
    expect(shown().size).toBe(0);
  });

  it('shows nothing, and remembers nothing, for events the filters drop', async () => {
    const event = prEvent();
    await notifyEvents([event], settings(), mute(emptyPrLocal(), event.prId));
    await notifyEvents([event], { ...settings(), enabled: false }, emptyPrLocal());
    expect(shown().size).toBe(0);
    expect(await stored()).toBeUndefined();
    // Dropped events are not used up: once allowed, the same event still notifies.
    await notify(event);
    expect(shown().size).toBe(1);
  });

  it('does nothing without events', async () => {
    await notify();
    expect(shown().size).toBe(0);
    expect(await stored()).toBeUndefined();
  });

  it('remembers the 300 most recent event ids, with their URLs', async () => {
    await notify(...events(305));
    const notified = (await stored()) ?? {};
    expect(Object.keys(notified)).toHaveLength(300);
    expect(notified[prEvent({ number: 305 }).id]).toBe('https://github.com/acme/widgets/pull/305');
    expect(notified[prEvent({ number: 5 }).id]).toBeUndefined();
    expect(notified[prEvent({ number: 6 }).id]).toBeDefined();
  });

  it('never rejects: a notification that fails is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(chrome.notifications, 'create').mockRejectedValue(new Error('no display'));
    await expect(notify(prEvent())).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    expect(await stored()).toBeUndefined();
  });
});

describe('onNotificationClicked', () => {
  it('opens the pull request and clears the notification', async () => {
    const event = prEvent({ number: 7 });
    await notify(event);
    await onNotificationClicked(event.id);
    expect(fakeChrome().__state.createdTabs).toEqual([
      { url: 'https://github.com/acme/widgets/pull/7' },
    ]);
    expect(shown().size).toBe(0);
  });

  it('opens nothing outside the GitHub web origin', async () => {
    const evil = [
      'https://github.com.evil.example/acme/widgets/pull/1',
      'javascript:alert(1)',
      'not a url',
      '',
    ];
    for (const [index, url] of evil.entries()) {
      const event = prEvent({ number: index + 1, url });
      await notify(event);
      await onNotificationClicked(event.id);
    }
    expect(fakeChrome().__state.createdTabs).toEqual([]);
    expect(shown().size).toBe(0);
  });

  it('only clears a notification it has no URL for, such as a summary', async () => {
    await notify(...events(4));
    const [id] = [...shown().keys()] as [string];
    await onNotificationClicked(id);
    await onNotificationClicked('constructor');
    expect(fakeChrome().__state.createdTabs).toEqual([]);
    expect(shown().size).toBe(0);
  });

  it('never rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(chrome.storage.session, 'get').mockRejectedValue(new Error('storage'));
    await expect(onNotificationClicked('x')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('forgetNotified', () => {
  it('forgets what was reported', async () => {
    await notify(prEvent());
    await forgetNotified();
    expect(await stored()).toBeUndefined();
  });
});

describe('onNotificationButtonClicked', () => {
  it('opens the pull request with the first button, like a click', async () => {
    const event = prEvent({ number: 7 });
    await notify(event);
    await onNotificationButtonClicked(event.id, 0);
    expect(fakeChrome().__state.createdTabs).toEqual([
      { url: 'https://github.com/acme/widgets/pull/7' },
    ]);
  });

  it('snoozes the pull request for an hour with the second button and clears it', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-07T10:00:00Z'), toFake: ['Date'] });
    const event = prEvent({ prId: 'PR_kwDOabc', number: 7 });
    await notify(event);
    await onNotificationButtonClicked(event.id, 1);
    const { prLocal } = await chrome.storage.local.get<{ prLocal: PrLocalState }>('prLocal');
    expect(prLocal.snoozed).toEqual({ PR_kwDOabc: '2026-10-07T11:00:00.000Z' });
    expect(shown().size).toBe(0);
    expect(fakeChrome().__state.createdTabs).toEqual([]);
    vi.useRealTimers();
  });

  it('only clears a notification it does not know, and never rejects', async () => {
    await onNotificationButtonClicked('summary:1', 1);
    expect(await chrome.storage.local.get('prLocal')).toEqual({});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(chrome.storage.session, 'get').mockRejectedValue(new Error('storage'));
    await expect(onNotificationButtonClicked('x', 1)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});
