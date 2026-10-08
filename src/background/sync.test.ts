import { describe, expect, it, vi } from 'vitest';
import { type Settings, STORAGE_KEYS, type SyncState } from '../lib/model';
import { defaultSettings, loadSettings, updateSettings } from '../lib/storage/settings';
import { setItem } from '../lib/storage/storage';
import { pullSettings, pushSettings, SYNCED_KEY, watchSettingsSync } from './sync';

const synced = async (): Promise<Record<string, unknown>> => chrome.storage.sync.get(null);
const syncState = async () => (await chrome.storage.local.get<{ sync: SyncState }>('sync')).sync;
/** Lets the listeners' storage round trips finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('settings sync', () => {
  it('does nothing until this device turns it on', async () => {
    watchSettingsSync();
    await updateSettings({ pollIntervalMinutes: 5 });
    await settle();
    expect(await synced()).toEqual({});
  });

  it('shares this device’s settings when sync is turned on and nothing is shared yet', async () => {
    watchSettingsSync();
    await updateSettings({ pollIntervalMinutes: 5 });
    await setItem(STORAGE_KEYS.sync, { enabled: true, error: null });
    await vi.waitFor(async () =>
      expect((await synced())[SYNCED_KEY]).toMatchObject({ pollIntervalMinutes: 5 }),
    );
    // Then every change follows, and only the settings ever reach Chrome sync.
    await updateSettings({ theme: 'dark' });
    await vi.waitFor(async () =>
      expect((await synced())[SYNCED_KEY]).toMatchObject({ theme: 'dark' }),
    );
    await chrome.storage.local.set({ auth: { token: 'ghp_secret' }, prLocal: {}, teams: {} });
    await settle();
    expect(Object.keys(await synced())).toEqual([SYNCED_KEY]);
    expect(await syncState()).toEqual({ enabled: true, error: null });
  });

  it('adopts the settings other devices share when sync is turned on', async () => {
    watchSettingsSync();
    await chrome.storage.sync.set({ [SYNCED_KEY]: { ...defaultSettings(), sort: 'created' } });
    await setItem(STORAGE_KEYS.sync, { enabled: true, error: null });
    await vi.waitFor(async () => expect((await loadSettings()).sort).toBe('created'));
  });

  it('applies changes from other devices, validated like any stored value', async () => {
    watchSettingsSync();
    await setItem(STORAGE_KEYS.sync, { enabled: true, error: null });
    await settle();
    await chrome.storage.sync.set({
      [SYNCED_KEY]: { ...defaultSettings(), pollIntervalMinutes: 9999, theme: 'neon' },
    });
    await vi.waitFor(async () => expect((await loadSettings()).pollIntervalMinutes).toBe(60));
    expect((await loadSettings()).theme).toBe('system');
  });

  it('keeps the settings on the device and says why when Chrome sync refuses them', async () => {
    await setItem(STORAGE_KEYS.sync, { enabled: true, error: null });
    const huge: Settings = {
      ...defaultSettings(),
      repoInclude: Array.from({ length: 400 }, (_, i) => `owner-${i}/repository-${i}`),
    };
    await pushSettings(huge);
    expect(await synced()).toEqual({});
    expect((await syncState()).error).toMatch(/more than the 8 KB Chrome sync keeps/);

    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(new Error('QUOTA_BYTES'));
    await pushSettings(defaultSettings());
    expect((await syncState()).error).toBe(
      'Chrome sync did not take your settings. They stay on this device.',
    );
    await pushSettings(defaultSettings());
    expect((await syncState()).error).toBeNull();
  });

  it('ignores a removed synced copy and leaves equal settings alone', async () => {
    await pullSettings(undefined);
    expect(await chrome.storage.local.get('settings')).toEqual({});
    await updateSettings({ sort: 'repo' });
    const set = vi.spyOn(chrome.storage.local, 'set');
    await pullSettings(await loadSettings());
    expect(set).not.toHaveBeenCalled();
  });

  it('logs a failure instead of rejecting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    watchSettingsSync();
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('storage'));
    await chrome.storage.sync.set({ [SYNCED_KEY]: defaultSettings() });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });
});
