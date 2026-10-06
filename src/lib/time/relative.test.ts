import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatRelativeTime', () => {
  it.each([
    [0, 'just now'],
    [MIN - 1, 'just now'],
    [MIN, '1 min ago'],
    [2 * MIN + 30_000, '2 min ago'],
    [HOUR - MIN, '59 min ago'],
    [HOUR, '1 h ago'],
    [DAY - MIN, '23 h ago'],
    [DAY, '1 d ago'],
    [45 * DAY, '45 d ago'],
  ])('%d ms ago reads "%s"', (elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it('accepts dates and epoch milliseconds, and defaults now to the clock', () => {
    expect(formatRelativeTime(new Date(NOW - 5 * MIN), new Date(NOW))).toBe('5 min ago');
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('3 h ago');
    expect(formatRelativeTime(Date.now() - 2 * MIN)).toBe('2 min ago');
  });

  it('never shows a negative or NaN age', () => {
    expect(formatRelativeTime(new Date(NOW + 10 * MIN), NOW)).toBe('just now');
    expect(formatRelativeTime('not a date', NOW)).toBe('just now');
  });
});
