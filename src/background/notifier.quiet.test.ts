import { afterEach, describe, expect, it, vi } from 'vitest';
import { prEvent } from '../../tests/fixtures/events';
import { emptyPrLocal, mute } from '../lib/storage/prLocal';
import { defaultSettings } from '../lib/storage/settings';
import { fakeChrome } from '../test/chrome';
import { forgetNotified, notifyEvents } from './notifier';

/** Quiet from 22:00 to 07:00, local time. */
const settings = () => ({
  ...defaultSettings().notifications,
  enabled: true,
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
});
const shown = () => fakeChrome().__state.notifications;
const at = (time: string) => vi.setSystemTime(new Date(`2026-10-06T${time}:00`));

describe('quiet-hours digest', () => {
  afterEach(() => vi.useRealTimers());

  it('holds events during quiet hours and shows one digest at the first poll after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('23:00');
    await notifyEvents(
      [prEvent({ number: 1 }), prEvent({ number: 2 })],
      settings(),
      emptyPrLocal(),
    );
    expect(shown().size).toBe(0);

    at('07:05');
    await notifyEvents([], settings(), emptyPrLocal());
    const [id] = [...shown().keys()];
    expect(id).toMatch(/^digest:\d+$/);
    expect(shown().get(id ?? '')?.options.title).toBe('During quiet hours: 2 updates');

    shown().clear();
    await notifyEvents([prEvent({ number: 1 })], settings(), emptyPrLocal());
    expect(shown().size).toBe(0);
  });

  it('leaves out events of PRs muted since, and forgets held events on sign-out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('23:00');
    const event = prEvent({ number: 3 });
    await notifyEvents([event], settings(), emptyPrLocal());
    at('08:00');
    await notifyEvents([], settings(), mute(emptyPrLocal(), event.prId));
    expect(shown().size).toBe(0);

    at('23:00');
    await notifyEvents([prEvent({ number: 4 })], settings(), emptyPrLocal());
    await forgetNotified();
    at('08:00');
    await notifyEvents([], settings(), emptyPrLocal());
    expect(shown().size).toBe(0);
  });
});
