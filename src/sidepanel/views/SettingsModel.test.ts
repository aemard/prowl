import { describe, expect, it } from 'vitest';
import { estimatedPointsPerHour, quietHoursNote } from './SettingsModel';

describe('estimatedPointsPerHour', () => {
  it.each([
    // The figures in docs/architecture.md: the defaults, and its heaviest example.
    [1, 50, 2, 120],
    [4, 100, 1, 1920],
    [1, 1, 60, 1],
    [0, 50, 2, 0],
  ])(
    '%i sections of %i pull requests every %i minutes cost about %i points an hour',
    (sections, perSection, minutes, points) => {
      expect(estimatedPointsPerHour(sections, perSection, minutes)).toBe(points);
    },
  );
});

describe('quietHoursNote', () => {
  it.each([
    [{ start: '12:00', end: '14:00' }, null],
    [{ start: '22:00', end: '08:00' }, 'This window crosses midnight and ends the next day.'],
    [{ start: '09:30', end: '09:30' }, 'Start and end are the same, so nothing is silenced.'],
  ])('describes %j', (window, text) => {
    expect(quietHoursNote(window)).toBe(text);
  });
});
