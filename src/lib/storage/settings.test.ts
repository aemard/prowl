import { describe, expect, it } from 'vitest';
import type { Settings } from '../model';
import {
  BUILT_IN_SECTION_KINDS,
  DEFAULT_SETTINGS,
  defaultSettings,
  normalizeSettings,
  PR_EVENT_TYPES,
  SETTINGS_VERSION,
} from './settings';
import { presets } from './settings.test-support';

describe('DEFAULT_SETTINGS', () => {
  it('matches the product defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      sections: presets(),
      repoInclude: [],
      repoExclude: [],
      pollIntervalMinutes: 5,
      maxPerSection: 50,
      notifications: {
        enabled: false,
        events: {
          ci_failed: true,
          ci_passed: true,
          review_new: true,
          approved: true,
          changes_requested: true,
          comment_new: true,
          ready_to_merge: true,
          merged: true,
          closed: true,
        },
        quietHours: { enabled: false, start: '22:00', end: '08:00' },
      },
      badge: 'attention',
      theme: 'system',
      sort: 'updated',
      groupByRepo: true,
      hideStaleAfterDays: 20,
      hideDrafts: false,
      hideBots: false,
      unfollowedTeams: [],
    } satisfies Settings);
  });

  it('is deeply frozen while defaultSettings() returns an independent copy', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.sections[0])).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.notifications.events)).toBe(true);
    expect(() => {
      (DEFAULT_SETTINGS as { theme: string }).theme = 'dark';
    }).toThrow(TypeError);

    const copy = defaultSettings();
    copy.notifications.events.merged = false;
    copy.sections.push({ id: 'x', kind: 'custom', label: 'x', enabled: true, query: 'x' });
    expect(DEFAULT_SETTINGS.notifications.events.merged).toBe(true);
    expect(defaultSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('lists every event type and preset kind', () => {
    expect(PR_EVENT_TYPES).toEqual(Object.keys(DEFAULT_SETTINGS.notifications.events));
    expect(PR_EVENT_TYPES).toHaveLength(9);
    expect(BUILT_IN_SECTION_KINDS).toEqual([
      'authored',
      'review_requested',
      'team_review_requested',
      'mentioned',
      'assigned',
    ]);
  });
});

it.each([undefined, null, 'settings', 42, true, [], [DEFAULT_SETTINGS]])(
  'normalizeSettings returns the defaults for %j',
  (value) => {
    expect(normalizeSettings(value)).toEqual(DEFAULT_SETTINGS);
  },
);

it('normalizeSettings is idempotent and keeps valid values', () => {
  const custom: Settings = {
    ...defaultSettings(),
    sections: [
      ...presets({ authored: false, assigned: true }).reverse(),
      { id: 'c1', kind: 'custom', label: 'Bots', enabled: false, query: 'author:app/dependabot' },
    ],
    repoInclude: ['octo-org', 'octo/hello.world'],
    repoExclude: ['octo/legacy'],
    pollIntervalMinutes: 15,
    maxPerSection: 100,
    notifications: {
      enabled: false,
      events: { ...DEFAULT_SETTINGS.notifications.events, ci_passed: false, comment_new: false },
      quietHours: { enabled: true, start: '23:30', end: '06:45' },
    },
    badge: 'unseen',
    theme: 'dark',
    sort: 'repo',
    groupByRepo: true,
    hideStaleAfterDays: 0,
    hideDrafts: true,
    hideBots: true,
    unfollowedTeams: ['acme/core', 'octo-org/web.ui'],
  };
  expect(normalizeSettings(custom)).toEqual(custom);
  expect(normalizeSettings(normalizeSettings(custom))).toEqual(custom);
  expect(normalizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
});

it('normalizeSettings never mutates its input', () => {
  const input = structuredClone({
    ...DEFAULT_SETTINGS,
    sections: [{ kind: 'custom', query: '  is:open  ', id: 'authored' }],
    pollIntervalMinutes: 0,
  });
  const snapshot = structuredClone(input);
  normalizeSettings(input);
  expect(input).toEqual(snapshot);
});

it('normalizeSettings defaults missing keys and drops unknown ones at every level', () => {
  const settings = normalizeSettings({
    theme: 'light',
    token: 'ghp_secret',
    notifications: {
      events: { merged: false, deployed: true },
      quietHours: { enabled: true, color: 'red' },
      sound: 'ping',
    },
  });
  expect(settings).toEqual({
    ...DEFAULT_SETTINGS,
    theme: 'light',
    notifications: {
      enabled: false,
      events: { ...DEFAULT_SETTINGS.notifications.events, merged: false },
      quietHours: { enabled: true, start: '22:00', end: '08:00' },
    },
  });
  expect(settings).not.toHaveProperty('token');
  expect(settings.notifications).not.toHaveProperty('sound');
  expect(settings.notifications.events).not.toHaveProperty('deployed');
  expect(settings.notifications.quietHours).not.toHaveProperty('color');
});

it.each([
  [0, 2],
  [-3, 2],
  [0.4, 2],
  [1, 2],
  [2, 2],
  [2.6, 3],
  [45, 45],
  [61, 60],
  [1e9, 60],
  [Number.NaN, 5],
  [Number.POSITIVE_INFINITY, 5],
  ['3', 5],
  [null, 5],
])('normalizeSettings repairs pollIntervalMinutes %j to %j', (value, expected) => {
  expect(normalizeSettings({ pollIntervalMinutes: value }).pollIntervalMinutes).toBe(expected);
});

it.each([
  [0, 1],
  [-10, 1],
  [1, 1],
  [50.5, 51],
  [100, 100],
  [101, 100],
  [Number.NaN, 50],
  ['20', 50],
  [undefined, 50],
])('normalizeSettings repairs maxPerSection %j to %j', (value, expected) => {
  expect(normalizeSettings({ maxPerSection: value }).maxPerSection).toBe(expected);
});

it.each([
  [0, 0],
  [-1, 0],
  [7.4, 7],
  [365, 365],
  [366, 365],
  [Number.POSITIVE_INFINITY, 20],
  ['30', 20],
  [null, 20],
])('normalizeSettings repairs hideStaleAfterDays %j to %j', (value, expected) => {
  expect(normalizeSettings({ hideStaleAfterDays: value }).hideStaleAfterDays).toBe(expected);
});

it.each(['groupByRepo', 'hideDrafts', 'hideBots'] as const)(
  'normalizeSettings repairs %s: a boolean, else its default',
  (key) => {
    expect(normalizeSettings({ [key]: true })[key]).toBe(true);
    expect(normalizeSettings({ [key]: false })[key]).toBe(false);
    for (const value of ['yes', 1, null, undefined]) {
      expect(normalizeSettings({ [key]: value })[key]).toBe(DEFAULT_SETTINGS[key]);
    }
    // Settings stored before the switches existed.
    expect(normalizeSettings({ hideStaleAfterDays: 5 })[key]).toBe(DEFAULT_SETTINGS[key]);
  },
);

it('normalizeSettings repairs notification switches and quiet hours', () => {
  const { notifications } = normalizeSettings({
    notifications: {
      enabled: 'yes',
      events: { ci_failed: 0, approved: false, closed: null },
      quietHours: { enabled: 1, start: '7:05', end: '24:00' },
    },
  });
  expect(notifications.enabled).toBe(false);
  expect(notifications.events.ci_failed).toBe(true);
  expect(notifications.events.approved).toBe(false);
  expect(notifications.events.closed).toBe(true);
  expect(notifications.quietHours).toEqual({ enabled: false, start: '07:05', end: '08:00' });

  expect(normalizeSettings({ notifications: { events: [false] } }).notifications).toEqual(
    DEFAULT_SETTINGS.notifications,
  );
  expect(normalizeSettings({ notifications: 'off' }).notifications).toEqual(
    DEFAULT_SETTINGS.notifications,
  );
});

it('normalizeSettings falls back to the default badge, theme and sort for unknown values', () => {
  const settings = normalizeSettings({ badge: 'count', theme: 'toString', sort: 42 });
  expect([settings.badge, settings.theme, settings.sort]).toEqual([
    'attention',
    'system',
    'updated',
  ]);
  const valid = normalizeSettings({ badge: 'off', theme: 'light', sort: 'created' });
  expect([valid.badge, valid.theme, valid.sort]).toEqual(['off', 'light', 'created']);
});

it('normalizeSettings cleans repository filters', () => {
  const settings = normalizeSettings({
    repoInclude: [
      ' octo-org ',
      'Octo/Hello.World',
      'octo/hello.world',
      'OCTO-ORG',
      'a/b_c-d',
      '',
      'owner/',
      '/name',
      'owner/name/extra',
      'own er',
      'repo:octo/x',
      '-owner',
      'owner/..',
      'a'.repeat(40),
      42,
      null,
    ],
    repoExclude: 'octo/legacy',
  });
  expect(settings.repoInclude).toEqual(['octo-org', 'Octo/Hello.World', 'a/b_c-d']);
  expect(settings.repoExclude).toEqual([]);
});

it('normalizeSettings cleans unfollowed teams: org/slug keys, lowercase, once', () => {
  const settings = normalizeSettings({
    unfollowedTeams: [
      ' Acme/Core ',
      'acme/core',
      'octo-org/web.ui',
      'acme',
      'acme/',
      '/core',
      'acme/core/x',
      '-acme/core',
      42,
      null,
    ],
  });
  expect(settings.unfollowedTeams).toEqual(['acme/core', 'octo-org/web.ui']);
  expect(normalizeSettings({ unfollowedTeams: 'acme/core' }).unfollowedTeams).toEqual([]);
});

it('normalizeSettings records the current version whatever version was stored', () => {
  expect(normalizeSettings({ version: 1 }).version).toBe(SETTINGS_VERSION);
  expect(normalizeSettings({}).version).toBe(SETTINGS_VERSION);
  expect(normalizeSettings({ version: 99, theme: 'dark', future: true })).toEqual({
    ...DEFAULT_SETTINGS,
    theme: 'dark',
  });
});
