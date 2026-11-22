import { describe, expect, it } from 'vitest';
import { prEvent } from '../../../tests/fixtures/events';
import type { NotificationSettings, PrEventType, TurnReason } from '../model';
import { emptyPrLocal, mute, snooze } from '../storage/prLocal';
import { defaultSettings } from '../storage/settings';
import { filterEvents } from './filterEvents';

const NOW = new Date(2026, 9, 6, 12, 0);
const settings = (change: (s: NotificationSettings) => void = () => {}): NotificationSettings => {
  const { notifications } = defaultSettings();
  notifications.enabled = true;
  change(notifications);
  return notifications;
};
const failed = prEvent({ type: 'ci_failed' });
const approved = prEvent({ type: 'approved', actor: 'hubot' });
const other = prEvent({ type: 'comment_new', number: 2 });

describe('filterEvents', () => {
  it('keeps enabled event types in order', () => {
    const events = [failed, approved, other];
    expect(filterEvents(events, settings(), emptyPrLocal(), NOW)).toEqual(events);
  });

  it('does not notify with the default settings', () => {
    expect(filterEvents([failed], defaultSettings().notifications, emptyPrLocal(), NOW)).toEqual(
      [],
    );
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

describe('filterEvents with turn events', () => {
  const turn = (reason: TurnReason, number = 1) => prEvent({ type: 'your_turn', reason, number });
  const without = (type: PrEventType) =>
    settings((s) => {
      s.events[type] = false;
    });
  const asked = prEvent({ type: 'review_requested' });
  const comment = prEvent({ type: 'comment_new' });
  const review = prEvent({ type: 'review_new', actor: 'hubot' });

  it.each<[PrEventType, TurnReason]>([
    ['ci_failed', 'ci_failed'],
    ['comment_new', 'feedback'],
    ['review_new', 'feedback'],
    ['changes_requested', 'changes_requested'],
    ['ready_to_merge', 'ready_to_merge'],
  ])('shows %s rather than the %s turn, and the turn when %s is off', (type, reason) => {
    const events = [prEvent({ type }), turn(reason)];
    expect(filterEvents(events, settings(), emptyPrLocal(), NOW)).toEqual([events[0]]);
    expect(filterEvents(events, without(type), emptyPrLocal(), NOW)).toEqual([events[1]]);
    expect(filterEvents(events, without('your_turn'), emptyPrLocal(), NOW)).toEqual([events[0]]);
  });

  it('keeps the turn beside events that do not tell it', () => {
    const conflicts = turn('conflicts');
    expect(filterEvents([comment, conflicts], settings(), emptyPrLocal(), NOW)).toEqual([
      comment,
      conflicts,
    ]);
    // A stranger's review says nothing of the review asked of the viewer.
    expect(filterEvents([review, asked], settings(), emptyPrLocal(), NOW)).toEqual([review, asked]);
  });

  it('only lets an event of the same pull request tell the turn', () => {
    const elsewhere = turn('feedback', 2);
    expect(filterEvents([comment, elsewhere], settings(), emptyPrLocal(), NOW)).toEqual([
      comment,
      elsewhere,
    ]);
  });

  it('drops both when their pull request is muted', () => {
    const local = mute(emptyPrLocal(), comment.prId);
    expect(filterEvents([comment, turn('feedback')], settings(), local, NOW)).toEqual([]);
  });
});
