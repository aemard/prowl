import { describe, expect, it } from 'vitest';
import { formatSnoozeEnd, SNOOZE_PRESETS, snoozeLabel, snoozeUntil } from './snooze';

// Wednesday 7 October 2026, 15:20 local time.
const WEDNESDAY = new Date(2026, 9, 7, 15, 20);

describe('snoozeUntil', () => {
  it('adds hours for the short presets', () => {
    expect(snoozeUntil('hour', WEDNESDAY)).toEqual(new Date(2026, 9, 7, 16, 20));
    expect(snoozeUntil('four_hours', WEDNESDAY.getTime())).toEqual(new Date(2026, 9, 7, 19, 20));
  });

  it('ends tomorrow and next Monday at 09:00', () => {
    expect(snoozeUntil('tomorrow', WEDNESDAY)).toEqual(new Date(2026, 9, 8, 9, 0));
    expect(snoozeUntil('monday', WEDNESDAY)).toEqual(new Date(2026, 9, 12, 9, 0));
    // On a Monday, "Monday" means the next one; on a Sunday, the day after.
    expect(snoozeUntil('monday', new Date(2026, 9, 12, 8, 0))).toEqual(new Date(2026, 9, 19, 9, 0));
    expect(snoozeUntil('monday', new Date(2026, 9, 11, 20, 0))).toEqual(
      new Date(2026, 9, 12, 9, 0),
    );
  });

  it('labels every preset', () => {
    expect(SNOOZE_PRESETS.map(snoozeLabel)).toEqual([
      'for 1 hour',
      'for 4 hours',
      'until tomorrow',
      'until Monday',
    ]);
  });
});

describe('formatSnoozeEnd', () => {
  it('shows only the time today and the weekday otherwise', () => {
    expect(formatSnoozeEnd(new Date(2026, 9, 7, 18, 5), WEDNESDAY)).toMatch(/18:05|6:05/);
    expect(formatSnoozeEnd(new Date(2026, 9, 8, 9, 0).toISOString(), WEDNESDAY)).toMatch(/^\D+ /);
  });
});
