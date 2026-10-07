/**
 * Typed access to `chrome.storage.local`, the only storage area Prowl uses (the token must
 * never reach `storage.sync`). Types are trusted here; the modules that own a key
 * (`settings.ts`, `prLocal.ts`) normalize what they read because stored data may be stale,
 * from an older version, or edited by hand.
 */
import type {
  AuthState,
  PollState,
  PrLocalState,
  Settings,
  Snapshot,
  StorageKey,
  TeamsState,
} from '../model';
import { jsonEqual } from './guards';

/** The value stored under each key of `STORAGE_KEYS`. */
export interface StorageSchema {
  settings: Settings;
  auth: AuthState;
  snapshot: Snapshot;
  pollState: PollState;
  prLocal: PrLocalState;
  teams: TeamsState;
}

/** Called with the new and previous value; `undefined` means the key is absent. */
export type StorageListener<K extends StorageKey> = (
  newValue: StorageSchema[K] | undefined,
  oldValue: StorageSchema[K] | undefined,
) => void;

export type Unsubscribe = () => void;

export async function getItem<K extends StorageKey>(key: K): Promise<StorageSchema[K] | undefined> {
  const items = await chrome.storage.local.get<Partial<StorageSchema>>(key);
  return items[key];
}

/** Reads several keys in one call. Absent keys are absent from the result. */
export async function getItems<K extends StorageKey>(
  keys: readonly K[],
): Promise<Partial<Pick<StorageSchema, K>>> {
  if (keys.length === 0) return {};
  return chrome.storage.local.get<Partial<Pick<StorageSchema, K>>>([...keys]);
}

export async function setItem<K extends StorageKey>(
  key: K,
  value: StorageSchema[K],
): Promise<void> {
  await chrome.storage.local.set<StorageSchema>({ [key]: value });
}

/** Writes several keys atomically (one `onChanged` event). `undefined` entries are skipped. */
export async function setItems(items: Partial<StorageSchema>): Promise<void> {
  const defined = Object.fromEntries(
    Object.entries(items).filter(([, value]) => value !== undefined),
  ) as Partial<StorageSchema>;
  if (Object.keys(defined).length === 0) return;
  await chrome.storage.local.set<StorageSchema>(defined);
}

export async function removeItems(...keys: StorageKey[]): Promise<void> {
  if (keys.length === 0) return;
  await chrome.storage.local.remove<StorageSchema>(keys);
}

/** Calls `listener` whenever `key` changes in `chrome.storage.local`, from any context. */
export function subscribe<K extends StorageKey>(key: K, listener: StorageListener<K>): Unsubscribe {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
    const change = changes[key];
    if (!change) return;
    listener(
      change.newValue as StorageSchema[K] | undefined,
      change.oldValue as StorageSchema[K] | undefined,
    );
  };
  chrome.storage.local.onChanged.addListener(onChanged);
  return () => chrome.storage.local.onChanged.removeListener(onChanged);
}

/**
 * Read-modify-write of one key, serialized with every other `updateItem` on the same key
 * (across the side panel and the service worker when Web Locks are available). Skips the
 * write when the value did not change, so listeners only hear about real changes.
 * Returns the value now stored.
 */
export async function updateItem<K extends StorageKey>(
  key: K,
  update: (current: StorageSchema[K] | undefined) => StorageSchema[K],
): Promise<StorageSchema[K]> {
  return withLock(`prowl:storage:${key}`, async () => {
    const current = await getItem(key);
    const next = update(current);
    if (!jsonEqual(current, next)) await setItem(key, next);
    return next;
  });
}

const fallbackQueues = new Map<string, Promise<unknown>>();

/**
 * Runs `task` exclusively for `name`. Uses the Web Locks API, which extension pages and the
 * service worker share because they have the same origin; falls back to an in-context queue
 * where it is missing. A failing task releases the lock and rejects with its own error.
 */
export async function withLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as { locks?: LockManager | null } | undefined)?.locks;
  if (locks) return locks.request(name, task);

  const previous = fallbackQueues.get(name) ?? Promise.resolve();
  const run = previous.then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  fallbackQueues.set(name, settled);
  void settled.then(() => {
    if (fallbackQueues.get(name) === settled) fallbackQueues.delete(name);
  });
  return run;
}
