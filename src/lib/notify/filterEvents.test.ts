import { describe, expect, it } from 'vitest';
import { prEvent } from '../../../tests/fixtures/events';
import type { NotificationSettings, PrEventType } from '../model';
import { emptyPrLocal, mute, snooze } from '../storage/prLocal';
import { defaultSettings } from '../storage/settings';
import { filterEvents } from './filterEvents';

const NOW = new Date(2026, 9, 6, 12, 0);
const settings = (change: (s: NotificationSettings) => void = () => {}): NotificationSettings => {
  const { notifications } = defaultSettings();
  change(notifications);
  return notifications;
};
const failed = prEvent({ type: 'ci_failed' });
const approved = prEvent({ type: 'approved', actor: 'hubot' });
const other = prEvent({ type: 'comment_new', number: 2 });

describe('filterEvents', () => {
  it('keeps everything by default, in order', () => {
    const events = [failed, approved, other];
    expect(filterEvents(events, settings(), emptyPrLocal(), NOW)).toEqual(events);
  });

  it('drops every event when notifications are off', () => {
    const off = settings((s) => {
      s.enabled = false;
    });
    expect(filterEvents([failed], off, emptyPrLocal(), NOW)).toEqual([]);
  });

  it.each([
    'ci_failed',
    'ci_passed',
    'review_new',
    'approved',
    'changes_requested',
    'comment_new',
    'ready_to_merge',
    'merged',
    'closed',
  ] satisfies PrEventType[])('drops %s when its toggle is off, and only that type', (type) => {
    const off = settings((s) => {
      s.events[type] = false;
    });
    const events = [prEvent({ type }), prEvent({ type: type === 'closed' ? 'merged' : 'closed' })];
    expect(filterEvents(events, off, emptyPrLocal(), NOW).map((e) => e.type)).not.toContain(type);
    expect(filterEvents(events, off, emptyPrLocal(), NOW)).toHaveLength(1);
  });

  it('drops the events of a muted pull request only', () => {
    const local = mute(emptyPrLocal(), failed.prId);
    expect(filterEvents([failed, approved, other], settings(), local, NOW)).toEqual([other]);
  });

  it('drops the events of a snoozed pull request until the snooze ends', () => {
    const local = snooze(emptyPrLocal(), failed.prId, NOW.getTime() + 60_000);
    expect(filterEvents([failed, other], settings(), local, NOW)).toEqual([other]);
    const later = new Date(NOW.getTime() + 60_000);
    expect(filterEvents([failed, other], settings(), local, later)).toEqual([failed, other]);
  });

  it('drops everything during quiet hours', () => {
    const quiet = settings((s) => {
      s.quietHours = { enabled: true, start: '22:00', end: '13:00' };
    });
    expect(filterEvents([failed, other], quiet, emptyPrLocal(), NOW)).toEqual([]);
    const evening = new Date(2026, 9, 6, 13, 0);
    expect(filterEvents([failed, other], quiet, emptyPrLocal(), evening)).toHaveLength(2);
  });

  it('ignores quiet hours that are off', () => {
    const idle = settings((s) => {
      s.quietHours = { enabled: false, start: '00:00', end: '23:59' };
    });
    expect(filterEvents([failed], idle, emptyPrLocal(), NOW)).toEqual([failed]);
  });
});
