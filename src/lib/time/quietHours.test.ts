import { describe, expect, it } from 'vitest';
import { isQuietNow } from './quietHours';

const at = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Date(2026, 9, 6, hours, minutes, 30);
};
const window = (start: string, end: string, enabled = true) => ({ enabled, start, end });

describe('isQuietNow', () => {
  it.each([
    ['08:59', false],
    ['09:00', true],
    ['12:00', true],
    ['16:59', true],
    ['17:00', false],
    ['23:00', false],
  ])('a window within the day, 09:00-17:00, at %s: %s', (time, quiet) => {
    expect(isQuietNow(window('09:00', '17:00'), at(time))).toBe(quiet);
  });

  it.each([
    ['21:59', false],
    ['22:00', true],
    ['23:59', true],
    ['00:00', true],
    ['06:59', true],
    ['07:00', false],
    ['12:00', false],
  ])('a window across midnight, 22:00-07:00, at %s: %s', (time, quiet) => {
    expect(isQuietNow(window('22:00', '07:00'), at(time))).toBe(quiet);
  });

  it('is never quiet when disabled', () => {
    expect(isQuietNow(window('22:00', '07:00', false), at('23:00'))).toBe(false);
  });

  it('treats equal start and end as an empty window', () => {
    expect(isQuietNow(window('10:00', '10:00'), at('10:00'))).toBe(false);
    expect(isQuietNow(window('10:00', '10:00'), at('22:00'))).toBe(false);
  });

  it('uses the current time by default', () => {
    expect(isQuietNow(window('00:00', '23:59')) || isQuietNow(window('23:59', '00:00'))).toBe(true);
  });
});
