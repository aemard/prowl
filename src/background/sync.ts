/**
 * Optional settings sync (US-041). While this device's `sync.enabled` is on, settings are mirrored
 * to `chrome.storage.sync` (Chrome's own sync, one key), and settings another device synced come
 * back through `normalizeSettings`, like any untrusted stored value. Chrome sync resolves
 * concurrent writes by keeping the last one. Only settings go there: the token, the snapshot,
 * local PR state and teams never leave the device. A write happens only when the two copies
 * differ, which also stops each side from echoing the other.
 */
import { type Settings, STORAGE_KEYS } from '../lib/model';
import { jsonEqual } from '../lib/storage/guards';
import { loadSettings, normalizeSettings, subscribeSettings } from '../lib/storage/settings';
import { getItem, subscribe, updateItem } from '../lib/storage/storage';

/** The only key Prowl writes to `chrome.storage.sync`. */
export const SYNCED_KEY = 'settings';
/** `chrome.storage.sync.QUOTA_BYTES_PER_ITEM`, which counts the key and the JSON value. */
const MAX_ITEM_BYTES = 8192;

const enabled = async () => (await getItem(STORAGE_KEYS.sync))?.enabled === true;
const remoteSettings = async (): Promise<unknown> =>
  (await chrome.storage.sync.get(SYNCED_KEY))[SYNCED_KEY];

const recordError = (error: string | null) =>
  updateItem(STORAGE_KEYS.sync, (state) => ({ enabled: state?.enabled ?? false, error }));

/** Writes this device's settings to Chrome sync, unless they are already there. */
export async function pushSettings(settings: Settings): Promise<void> {
  if (jsonEqual(await remoteSettings(), settings)) return recordError(null).then(() => undefined);
  const bytes = new TextEncoder().encode(SYNCED_KEY + JSON.stringify(settings)).length;
  let error: string | null = null;
  if (bytes > MAX_ITEM_BYTES) {
    error = `Your settings take ${Math.ceil(bytes / 1024)} KB, more than the 8 KB Chrome sync keeps: remove some repositories or sections. They stay on this device.`;
  } else {
    try {
      await chrome.storage.sync.set({ [SYNCED_KEY]: settings });
    } catch {
      error = 'Chrome sync did not take your settings. They stay on this device.';
    }
  }
  await recordError(error);
}

/** Applies settings another device synced, validated like any stored value. */
export async function pullSettings(remote: unknown): Promise<void> {
  if (remote === undefined) return;
  const settings = normalizeSettings(remote);
  await updateItem(STORAGE_KEYS.settings, (local) =>
    local !== undefined && jsonEqual(normalizeSettings(local), settings) ? local : settings,
  );
}

/** Turning sync on adopts the copy already shared by other devices, else shares this one. */
async function start(): Promise<void> {
  const remote = await remoteSettings();
  if (remote === undefined) await pushSettings(await loadSettings());
  else await pullSettings(remote);
}

/** Registers the listeners; called synchronously at worker startup. Never rejects. */
export function watchSettingsSync(): void {
  const run = (task: () => Promise<void>) =>
    void task().catch((error) => console.error('Prowl: settings sync failed', error));
  subscribeSettings((settings) =>
    run(async () => {
      if (await enabled()) await pushSettings(settings);
    }),
  );
  chrome.storage.sync.onChanged.addListener((changes) => {
    const change = changes[SYNCED_KEY];
    if (!change) return;
    run(async () => {
      if (await enabled()) await pullSettings(change.newValue);
    });
  });
  subscribe(STORAGE_KEYS.sync, (now, before) => {
    if (now?.enabled && !before?.enabled) run(start);
  });
}
