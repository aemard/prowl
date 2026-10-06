import type { QuietHours } from '../model';

/** Minutes since midnight of an `HH:MM` time (normalized by the settings). */
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * True while `now` (local time) is inside the quiet window: from `start` (inclusive) to `end`
 * (exclusive), which may wrap past midnight (22:00 -> 07:00). `start === end` is an empty
 * window, not a whole day.
 */
export function isQuietNow(quiet: QuietHours, now: Date = new Date()): boolean {
  if (!quiet.enabled) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  const minute = now.getHours() * 60 + now.getMinutes();
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}
