import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import {
  DEFAULT_SETTINGS,
  defaultSettings,
  ensureSettings,
  loadSettings,
  migrateSettings,
  SETTINGS_MIGRATIONS,
  SETTINGS_VERSION,
  type SettingsMigration,
  subscribeSettings,
  updateSettings,
} from './settings';

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
      pollIntervalMinutes: 2,
      theme: 'dark',
    });
  });

  it('applies a patch, normalizes it and persists the result', async () => {
    const saved = await updateSettings({ pollIntervalMinutes: 0.2, sort: 'repo' });
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, pollIntervalMinutes: 2, sort: 'repo' });
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
      [{ ...DEFAULT_SETTINGS, theme: 'dark', pollIntervalMinutes: 2 }],
      [DEFAULT_SETTINGS],
    ]);
  });
});
