import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import type { Section, Settings } from '../model';
import {
  BUILT_IN_SECTION_KINDS,
  DEFAULT_SETTINGS,
  defaultSettings,
  ensureSettings,
  loadSettings,
  migrateSettings,
  normalizeRepoPattern,
  normalizeSettings,
  normalizeTime,
  PR_EVENT_TYPES,
  SETTINGS_MIGRATIONS,
  SETTINGS_VERSION,
  type SettingsMigration,
  subscribeSettings,
  updateSettings,
} from './settings';

const presets = (overrides: Partial<Record<string, boolean>> = {}): Section[] => [
  { id: 'authored', kind: 'authored', label: 'Created by me', enabled: overrides.authored ?? true },
  {
    id: 'review_requested',
    kind: 'review_requested',
    label: 'Review requested',
    enabled: overrides.review_requested ?? false,
  },
  { id: 'mentioned', kind: 'mentioned', label: 'Mentioned', enabled: overrides.mentioned ?? false },
  {
    id: 'assigned',
    kind: 'assigned',
    label: 'Assigned to me',
    enabled: overrides.assigned ?? false,
  },
];

function sectionsOf(sections: unknown): Section[] {
  return normalizeSettings({ ...defaultSettings(), sections }).sections;
}

describe('DEFAULT_SETTINGS', () => {
  it('matches the product defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      sections: presets(),
      repoInclude: [],
      repoExclude: [],
      pollIntervalMinutes: 2,
      maxPerSection: 50,
      notifications: {
        enabled: true,
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
      hideStaleAfterDays: 20,
      hideDrafts: false,
      hideBots: false,
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
      'mentioned',
      'assigned',
    ]);
  });
});

describe('normalizeSettings', () => {
  it.each([undefined, null, 'settings', 42, true, [], [DEFAULT_SETTINGS]])(
    'returns the defaults for %j',
    (value) => {
      expect(normalizeSettings(value)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('is idempotent and keeps valid values', () => {
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
      hideStaleAfterDays: 0,
      hideDrafts: true,
      hideBots: true,
    };
    expect(normalizeSettings(custom)).toEqual(custom);
    expect(normalizeSettings(normalizeSettings(custom))).toEqual(custom);
    expect(normalizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('never mutates its input', () => {
    const input = structuredClone({
      ...DEFAULT_SETTINGS,
      sections: [{ kind: 'custom', query: '  is:open  ', id: 'authored' }],
      pollIntervalMinutes: 0,
    });
    const snapshot = structuredClone(input);
    normalizeSettings(input);
    expect(input).toEqual(snapshot);
  });

  it('defaults missing keys and drops unknown ones at every level', () => {
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
        enabled: true,
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
    [0, 1],
    [-3, 1],
    [0.4, 1],
    [1, 1],
    [2.4, 2],
    [2.6, 3],
    [45, 45],
    [61, 60],
    [1e9, 60],
    [Number.NaN, 2],
    [Number.POSITIVE_INFINITY, 2],
    ['5', 2],
    [null, 2],
  ])('repairs pollIntervalMinutes %j to %j', (value, expected) => {
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
  ])('repairs maxPerSection %j to %j', (value, expected) => {
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
  ])('repairs hideStaleAfterDays %j to %j', (value, expected) => {
    expect(normalizeSettings({ hideStaleAfterDays: value }).hideStaleAfterDays).toBe(expected);
  });

  it.each(['hideDrafts', 'hideBots'] as const)('repairs %s: a boolean, else off', (key) => {
    expect(normalizeSettings({ [key]: true })[key]).toBe(true);
    expect(normalizeSettings({ [key]: false })[key]).toBe(false);
    for (const value of ['yes', 1, null, undefined]) {
      expect(normalizeSettings({ [key]: value })[key]).toBe(false);
    }
    // Settings stored before the switches existed.
    expect(normalizeSettings({ hideStaleAfterDays: 5 })[key]).toBe(false);
  });

  it('repairs notification switches and quiet hours', () => {
    const { notifications } = normalizeSettings({
      notifications: {
        enabled: 'yes',
        events: { ci_failed: 0, approved: false, closed: null },
        quietHours: { enabled: 1, start: '7:05', end: '24:00' },
      },
    });
    expect(notifications.enabled).toBe(true);
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

  it('falls back to the default badge, theme and sort for unknown values', () => {
    const settings = normalizeSettings({ badge: 'count', theme: 'toString', sort: 42 });
    expect([settings.badge, settings.theme, settings.sort]).toEqual([
      'attention',
      'system',
      'updated',
    ]);
    const valid = normalizeSettings({ badge: 'off', theme: 'light', sort: 'created' });
    expect([valid.badge, valid.theme, valid.sort]).toEqual(['off', 'light', 'created']);
  });

  it('cleans repository filters', () => {
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

  it('records the current version whatever version was stored', () => {
    expect(normalizeSettings({ version: 1 }).version).toBe(SETTINGS_VERSION);
    expect(normalizeSettings({}).version).toBe(SETTINGS_VERSION);
    expect(normalizeSettings({ version: 99, theme: 'dark', future: true })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
    });
  });
});

describe('normalizeSettings sections', () => {
  it('uses the default sections when sections is not a list', () => {
    expect(sectionsOf(undefined)).toEqual(presets());
    expect(sectionsOf({ authored: true })).toEqual(presets());
  });

  it('keeps the stored order and appends missing presets with their defaults', () => {
    expect(
      sectionsOf([
        { id: 'mentioned', kind: 'mentioned', label: 'Mentioned', enabled: true },
        {
          id: 'c1',
          kind: 'custom',
          label: 'Team',
          enabled: true,
          query: 'team-review-requested:org/team',
        },
      ]),
    ).toEqual([
      { id: 'mentioned', kind: 'mentioned', label: 'Mentioned', enabled: true },
      {
        id: 'c1',
        kind: 'custom',
        label: 'Team',
        enabled: true,
        query: 'team-review-requested:org/team',
      },
      ...presets().filter((section) => section.kind !== 'mentioned'),
    ]);
    expect(sectionsOf([])).toEqual(presets());
  });

  it('gives presets their canonical id and label, drops duplicates and stray queries', () => {
    expect(
      sectionsOf([
        { id: 'mine', kind: 'authored', label: 'Mine', enabled: false, query: 'is:draft', x: 1 },
        { id: 'authored', kind: 'authored', enabled: true },
        { kind: 'assigned', enabled: 'no' },
      ]),
    ).toEqual([
      { id: 'authored', kind: 'authored', label: 'Created by me', enabled: false },
      { id: 'assigned', kind: 'assigned', label: 'Assigned to me', enabled: false },
      ...presets().slice(1, 3),
    ]);
  });

  it('drops entries that are not sections', () => {
    expect(sectionsOf([null, 'authored', 7, [], { kind: 'issues' }, { id: 'x' }])).toEqual(
      presets(),
    );
  });

  it('requires a query for custom sections and trims query and label', () => {
    const sections = sectionsOf([
      { id: 'empty', kind: 'custom', label: 'Empty', query: '   ' },
      { id: 'missing', kind: 'custom', label: 'Missing' },
      { id: 'number', kind: 'custom', label: 'Number', query: 42 },
      { id: 'ok', kind: 'custom', label: '  Bots  ', query: '  author:app/renovate  ' },
    ]);
    expect(sections.filter((section) => section.kind === 'custom')).toEqual([
      { id: 'ok', kind: 'custom', label: 'Bots', enabled: true, query: 'author:app/renovate' },
    ]);
  });

  it('falls back to the query as label and caps labels at 60 characters', () => {
    const [blank, long] = sectionsOf([
      { id: 'a', kind: 'custom', label: '  ', enabled: false, query: 'label:urgent' },
      { id: 'b', kind: 'custom', label: 'x'.repeat(80), query: 'q' },
    ]);
    expect(blank).toEqual({
      id: 'a',
      kind: 'custom',
      label: 'label:urgent',
      enabled: false,
      query: 'label:urgent',
    });
    expect(long?.label).toBe('x'.repeat(60));
  });

  it('assigns custom-N ids to custom sections whose id is missing, invalid, a preset or taken', () => {
    const ids = sectionsOf([
      { kind: 'custom', query: 'a' },
      { id: 'has space', kind: 'custom', query: 'b' },
      { id: 'authored', kind: 'custom', query: 'c' },
      { id: 'custom-1', kind: 'custom', query: 'd' },
      { id: 'dup', kind: 'custom', query: 'e' },
      { id: 'dup', kind: 'custom', query: 'f' },
      { id: 'x'.repeat(65), kind: 'custom', query: 'g' },
      { id: 'authored', kind: 'authored' },
    ]).map((section) => section.id);
    expect(ids).toEqual([
      'custom-2',
      'custom-3',
      'custom-4',
      'custom-1',
      'dup',
      'custom-5',
      'custom-6',
      'authored',
      'review_requested',
      'mentioned',
      'assigned',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeTime', () => {
  it.each([
    ['00:00', '00:00'],
    ['7:05', '07:05'],
    [' 23:59 ', '23:59'],
    ['24:00', null],
    ['12:60', null],
    ['12:5', null],
    ['1200', null],
    ['', null],
    [930, null],
  ])('normalizes %j to %j', (value, expected) => {
    expect(normalizeTime(value)).toBe(expected);
  });
});

describe('normalizeRepoPattern', () => {
  it('accepts owners and owner/name and rejects everything else', () => {
    expect(normalizeRepoPattern('  octo  ')).toBe('octo');
    expect(normalizeRepoPattern('octo/.github')).toBe('octo/.github');
    expect(normalizeRepoPattern(`${'a'.repeat(39)}/${'b'.repeat(100)}`)).not.toBeNull();
    for (const invalid of ['octo/.', `${'a'.repeat(40)}`, `a/${'b'.repeat(101)}`, 'a b', 'é']) {
      expect(normalizeRepoPattern(invalid)).toBeNull();
    }
    expect(normalizeRepoPattern(undefined)).toBeNull();
  });
});

describe('migrateSettings', () => {
  const migrations: Record<number, SettingsMigration> = {
    1: (raw) => ({ ...raw, pollMinutes: undefined, pollIntervalMinutes: raw.pollMinutes }),
    2: (raw) => ({ ...raw, theme: raw.theme === 'auto' ? 'system' : raw.theme }),
  };

  it('runs each step from the stored version up to the target, in order', () => {
    const steps: number[] = [];
    const tracked = Object.fromEntries(
      Object.entries(migrations).map(([from, step]) => [
        from,
        (raw: Record<string, unknown>) => {
          steps.push(Number(from));
          return step(raw);
        },
      ]),
    );
    const result = migrateSettings({ version: 1, pollMinutes: 5, theme: 'auto' }, tracked, 3);
    expect(steps).toEqual([1, 2]);
    expect(result).toMatchObject({ version: 3, pollIntervalMinutes: 5, theme: 'system' });
  });

  it('treats unversioned or invalid versions as version 1', () => {
    for (const version of [undefined, 0, -1, 1.5, '2']) {
      expect(migrateSettings({ version, pollMinutes: 7 }, migrations, 2)).toMatchObject({
        version: 2,
        pollIntervalMinutes: 7,
      });
    }
  });

  it('starts from the stored version and leaves newer data alone', () => {
    expect(migrateSettings({ version: 2, theme: 'auto' }, migrations, 3)).toEqual({
      version: 3,
      theme: 'system',
    });
    const future = { version: 5, theme: 'auto' };
    expect(migrateSettings(future, migrations, 3)).toEqual(future);
  });

  it('stops at a missing step instead of throwing', () => {
    expect(
      migrateSettings({ version: 1, theme: 'auto' }, { 2: migrations[2] as SettingsMigration }, 3),
    ).toEqual({ version: 1, theme: 'auto' });
  });

  it('has a migration for every version below the current one', () => {
    for (let version = 1; version < SETTINGS_VERSION; version += 1) {
      expect(SETTINGS_MIGRATIONS[version], `migration from v${version}`).toBeTypeOf('function');
    }
    expect(migrateSettings({ version: SETTINGS_VERSION, theme: 'dark' })).toEqual({
      version: SETTINGS_VERSION,
      theme: 'dark',
    });
  });
});

describe('settings storage', () => {
  it('loads the defaults on first run without writing', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(fakeChrome().storage.local.data.has('settings')).toBe(false);
  });

  it('loads stored settings normalized', async () => {
    await chrome.storage.local.set({ settings: { pollIntervalMinutes: 0, theme: 'dark' } });
    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      pollIntervalMinutes: 1,
      theme: 'dark',
    });
  });

  it('applies a patch, normalizes it and persists the result', async () => {
    const saved = await updateSettings({ pollIntervalMinutes: 0.2, sort: 'repo' });
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, pollIntervalMinutes: 1, sort: 'repo' });
    expect(fakeChrome().storage.local.data.get('settings')).toEqual(saved);

    const next = await updateSettings((current) => ({
      ...current,
      repoExclude: [...current.repoExclude, ' octo/legacy ', 'not valid'],
    }));
    expect(next).toEqual({ ...saved, repoExclude: ['octo/legacy'] });
    expect(await loadSettings()).toEqual(next);
  });

  it('does not lose concurrent patches', async () => {
    await Promise.all([
      updateSettings({ theme: 'dark' }),
      updateSettings({ badge: 'off' }),
      updateSettings((current) => ({ ...current, maxPerSection: 10 })),
    ]);
    expect(await loadSettings()).toMatchObject({ theme: 'dark', badge: 'off', maxPerSection: 10 });
  });

  it('ensureSettings writes the defaults on first run and repairs stored values', async () => {
    expect(await ensureSettings()).toEqual(DEFAULT_SETTINGS);
    expect(fakeChrome().storage.local.data.get('settings')).toEqual(DEFAULT_SETTINGS);

    await chrome.storage.local.set({ settings: { maxPerSection: 500, legacy: true } });
    expect(await ensureSettings()).toEqual({ ...DEFAULT_SETTINGS, maxPerSection: 100 });
    expect(fakeChrome().storage.local.data.get('settings')).toEqual({
      ...DEFAULT_SETTINGS,
      maxPerSection: 100,
    });
  });

  it('ensureSettings does not write when the stored settings are current', async () => {
    await chrome.storage.local.set({ settings: defaultSettings() });
    const set = vi.spyOn(chrome.storage.local, 'set');
    await ensureSettings();
    expect(set).not.toHaveBeenCalled();
  });

  it('notifies subscribers with normalized settings', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);
    await chrome.storage.local.set({ settings: { theme: 'dark', pollIntervalMinutes: -1 } });
    await chrome.storage.local.remove('settings');
    unsubscribe();
    await updateSettings({ theme: 'light' });
    expect(listener.mock.calls).toEqual([
      [{ ...DEFAULT_SETTINGS, theme: 'dark', pollIntervalMinutes: 1 }],
      [DEFAULT_SETTINGS],
    ]);
  });
});
