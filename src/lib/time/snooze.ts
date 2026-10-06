/** Snooze presets offered on every card. Times are local, like the user's working day. */
export type SnoozePreset = 'hour' | 'four_hours' | 'tomorrow' | 'monday';

export const SNOOZE_PRESETS: readonly SnoozePreset[] = ['hour', 'four_hours', 'tomorrow', 'monday'];

const MORNING_HOUR = 9;

/** When a snooze started at `now` with `preset` ends. */
export function snoozeUntil(preset: SnoozePreset, now: Date | number): Date {
  const start = new Date(now);
  if (preset === 'hour') return new Date(start.getTime() + 3_600_000);
  if (preset === 'four_hours') return new Date(start.getTime() + 4 * 3_600_000);
  const day = new Date(start);
  day.setHours(MORNING_HOUR, 0, 0, 0);
  // Tomorrow, or the next Monday (a week ahead when today is Monday).
  const days = preset === 'tomorrow' ? 1 : (8 - start.getDay()) % 7 || 7;
  day.setDate(day.getDate() + days);
  return day;
}

/** How long a preset lasts, to follow "Snooze": "for 1 hour", "until Monday". */
export function snoozeLabel(preset: SnoozePreset): string {
  return {
    hour: 'for 1 hour',
    four_hours: 'for 4 hours',
    tomorrow: 'until tomorrow',
    monday: 'until Monday',
  }[preset];
}

/** "14:30" today, else "Mon 09:00": when a snooze ends, short. */
export function formatSnoozeEnd(until: Date | number | string, now: Date | number): string {
  const end = new Date(until);
  const time = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return end.toDateString() === new Date(now).toDateString()
    ? time
    : `${end.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}
