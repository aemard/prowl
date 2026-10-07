/**
 * Side panel state: one signal per storage key, filled from `chrome.storage.local` before the
 * first real render and kept in sync by `onChanged` (so writes from the service worker, such
 * as a new snapshot, show up without any message). The panel only reads these; the service
 * worker owns `snapshot` and `pollState`.
 */
import { batch, signal } from '@preact/signals';
import {
  type AuthState,
  type PollState,
  type PrLocalState,
  type Settings,
  type Snapshot,
  STORAGE_KEYS,
  type StorageKey,
  type SyncState,
  type TeamsState,
} from '../../lib/model';
import { emptyPrLocal, normalizePrLocal } from '../../lib/storage/prLocal';
import { defaultSettings, normalizeSettings } from '../../lib/storage/settings';
import { getItems, subscribe } from '../../lib/storage/storage';

export const settings = signal<Settings>(defaultSettings());
/** Undefined = signed out. */
export const auth = signal<AuthState | undefined>(undefined);
export const snapshot = signal<Snapshot | undefined>(undefined);
export const pollState = signal<PollState | undefined>(undefined);
export const prLocal = signal<PrLocalState>(emptyPrLocal());
/** The viewer's teams as the worker last discovered them; undefined until then. */
export const teams = signal<TeamsState | undefined>(undefined);
/** Whether this device syncs its settings through Chrome, and the last sync error. */
export const sync = signal<SyncState | undefined>(undefined);
/** False until the first read of storage has been applied: show a skeleton, not a guess. */
export const hydrated = signal(false);

// Settings and prLocal are normalized on every read; auth, snapshot, pollState and teams are
// only written by Prowl, so their stored shape is trusted.
const BINDINGS: Record<StorageKey, (raw: unknown) => void> = {
  [STORAGE_KEYS.settings]: (raw) => {
    settings.value = normalizeSettings(raw);
  },
  [STORAGE_KEYS.auth]: (raw) => {
    auth.value = raw as AuthState | undefined;
  },
  [STORAGE_KEYS.snapshot]: (raw) => {
    snapshot.value = raw as Snapshot | undefined;
  },
  [STORAGE_KEYS.pollState]: (raw) => {
    pollState.value = raw as PollState | undefined;
  },
  [STORAGE_KEYS.prLocal]: (raw) => {
    prLocal.value = normalizePrLocal(raw);
  },
  [STORAGE_KEYS.teams]: (raw) => {
    teams.value = raw as TeamsState | undefined;
  },
  [STORAGE_KEYS.sync]: (raw) => {
    sync.value = raw as SyncState | undefined;
  },
};
const KEYS = Object.keys(BINDINGS) as StorageKey[];

/**
 * Reads every key into the signals, then keeps them in sync. Returns the function that stops
 * listening. A change that arrives while the first read is in flight wins over that (older)
 * read, so a stale `pollState.inFlight` cannot stick.
 */
export async function hydrateStore(): Promise<() => void> {
  hydrated.value = false;
  const changed = new Set<StorageKey>();
  const stops = KEYS.map((key) =>
    subscribe(key, (value) => {
      changed.add(key);
      BINDINGS[key](value);
    }),
  );
  const stored: Partial<Record<StorageKey, unknown>> = await getItems(KEYS);
  batch(() => {
    for (const key of KEYS) if (!changed.has(key)) BINDINGS[key](stored[key]);
    hydrated.value = true;
  });
  return () => {
    for (const stop of stops) stop();
  };
}
