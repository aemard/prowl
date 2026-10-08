import { describe, expect, it } from 'vitest';
import { describePermissions, estimatedPointsPerHour, quietHoursNote } from './SettingsModel';

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

describe('describePermissions', () => {
  const shipped = {
    permissions: ['notifications', 'sidePanel', 'storage', 'alarms'],
    origins: ['https://api.github.com/*'],
  };

  it('describes what Prowl holds at install, in a fixed order, then the sites', () => {
    expect(describePermissions(shipped).map((row) => row.title)).toEqual([
      'Side panel',
      'Storage',
      'Alarms',
      'Notifications',
      'api.github.com',
    ]);
    expect(describePermissions(shipped).at(-1)?.detail).toMatch(/Read your pull requests/);
  });

  it('adds github.com only once it is granted', () => {
    const signingIn = { ...shipped, origins: [...shipped.origins, 'https://github.com/*'] };
    const rows = describePermissions(signingIn);
    expect(rows.map((row) => row.title).slice(-2)).toEqual(['api.github.com', 'github.com']);
    expect(rows.at(-1)?.detail).toMatch(/Sign in with GitHub.*gives it back/);
  });

  it('shows anything else under its own name, so a new permission cannot hide', () => {
    const rows = describePermissions({
      permissions: ['tabs', 'storage'],
      origins: ['<all_urls>', 'https://example.com/*'],
    });
    expect(rows).toEqual([
      { title: 'Storage', detail: expect.any(String) },
      { title: 'tabs', detail: 'Not described by this version of Prowl.' },
      { title: '<all_urls>', detail: 'Read and change your data on this site.' },
      { title: 'example.com', detail: 'Read and change your data on this site.' },
    ]);
  });

  it('copes with nothing granted', () => {
    expect(describePermissions({})).toEqual([]);
  });
});
