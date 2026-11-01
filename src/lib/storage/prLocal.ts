/**
 * Local-only per-PR state: snooze, mute and "seen". The operations are pure reducers over
 * `PrLocalState` (they return the same object when nothing changes) so the notifier and the
 * badge can evaluate them on state already in memory, and several of them can be combined
 * into one write: `await updatePrLocal((s) => snooze(s, id, until))`.
 */
import { activityKey } from '../activity';
import { type PrLocalState, type PullRequest, STORAGE_KEYS } from '../model';
import { isDateString, isRecord, toMillis } from './guards';
import { getItem, subscribe, type Unsubscribe, updateItem } from './storage';

export function emptyPrLocal(): PrLocalState {
  return { snoozed: {}, muted: {}, seen: {} };
}

function ownValue<V>(record: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Returns `record` itself when every entry is kept. */
function filterRecord<V>(
  record: Record<string, V>,
  keep: (key: string, value: V) => boolean,
): Record<string, V> {
  const entries = Object.entries(record);
  const kept = entries.filter(([key, value]) => keep(key, value));
  return kept.length === entries.length ? record : Object.fromEntries(kept);
}

function validEntries<V>(value: unknown, isValid: (item: unknown) => item is V): Record<string, V> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, V] => entry[0] !== '' && isValid(entry[1]),
    ),
  );
}

/** Repairs any stored value: invalid maps become empty and invalid entries are dropped. */
export function normalizePrLocal(value: unknown): PrLocalState {
  const raw: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    snoozed: validEntries(raw.snoozed, isDateString),
    muted: validEntries(raw.muted, (item): item is true => item === true),
    seen: validEntries(raw.seen, isDateString),
    ...(isRecord(raw.seenFacts)
      ? {
          seenFacts: validEntries(
            raw.seenFacts,
            (item): item is string => typeof item === 'string' && item.length <= 16_384,
          ),
        }
      : {}),
    ...(isRecord(raw.alwaysShown)
      ? { alwaysShown: validEntries(raw.alwaysShown, (item): item is true => item === true) }
      : {}),
  };
}

/** Snoozes a PR until `until` (a `Date` or epoch ms). Throws `RangeError` for an invalid date. */
export function snooze(state: PrLocalState, id: string, until: Date | number): PrLocalState {
  const iso = new Date(toMillis(until)).toISOString();
  if (ownValue(state.snoozed, id) === iso) return state;
  return { ...state, snoozed: { ...state.snoozed, [id]: iso } };
}

export function unsnooze(state: PrLocalState, id: string): PrLocalState {
  if (!Object.hasOwn(state.snoozed, id)) return state;
  return { ...state, snoozed: filterRecord(state.snoozed, (key) => key !== id) };
}

export function mute(state: PrLocalState, id: string): PrLocalState {
  if (ownValue(state.muted, id) === true) return state;
  return { ...state, muted: { ...state.muted, [id]: true } };
}

export function unmute(state: PrLocalState, id: string): PrLocalState {
  if (!Object.hasOwn(state.muted, id)) return state;
  return { ...state, muted: filterRecord(state.muted, (key) => key !== id) };
}

/**
 * Records that the user has seen the PR as of its `updatedAt`. Never moves backwards, so a
 * stale snapshot cannot mark newer activity as unseen again. Invalid dates are ignored.
 */
export function markSeen(
  state: PrLocalState,
  id: string,
  updatedAt: string,
  facts?: string,
): PrLocalState {
  if (!isDateString(updatedAt)) return state;
  const seen = ownValue(state.seen, id);
  if (seen !== undefined && Date.parse(seen) > Date.parse(updatedAt)) return state;
  if (seen === updatedAt && (facts === undefined || state.seenFacts?.[id] === facts)) return state;
  return {
    ...state,
    seen: { ...state.seen, [id]: updatedAt },
    ...(facts === undefined ? {} : { seenFacts: { ...state.seenFacts, [id]: facts } }),
  };
}

/** Seed legacy timestamp markers from the previous snapshot, avoiding a false unread migration. */
export function baselineSeenFacts(
  state: PrLocalState,
  prs: Record<string, PullRequest>,
): PrLocalState {
  let next = state;
  for (const pr of Object.values(prs)) {
    if (ownValue(next.seenFacts ?? {}, pr.id) === undefined && isSeen(next, pr.id, pr.updatedAt))
      next = markSeen(next, pr.id, pr.updatedAt, activityKey(pr));
  }
  return next;
}

export function isAlwaysShown(state: Pick<PrLocalState, 'alwaysShown'>, id: string): boolean {
  return ownValue(state.alwaysShown ?? {}, id) === true;
}

export function setAlwaysShown(state: PrLocalState, id: string, shown: boolean): PrLocalState {
  if (isAlwaysShown(state, id) === shown) return state;
  const alwaysShown = state.alwaysShown ?? {};
  return {
    ...state,
    alwaysShown: shown
      ? { ...alwaysShown, [id]: true }
      : filterRecord(alwaysShown, (key) => key !== id),
  };
}

/** True while a snooze for the PR has not ended. */
export function isSnoozed(state: PrLocalState, id: string, now: Date | number): boolean {
  const until = ownValue(state.snoozed, id);
  return until !== undefined && Date.parse(until) > toMillis(now);
}

export function isMuted(state: PrLocalState, id: string): boolean {
  return ownValue(state.muted, id) === true;
}

/** True when the user has seen the PR at `updatedAt` or later. */
export function isSeen(
  state: PrLocalState,
  id: string,
  updatedAt: string,
  facts?: string,
): boolean {
  const seen = ownValue(state.seen, id);
  if (seen === undefined) return false;
  if (Date.parse(seen) > Date.parse(updatedAt)) return true;
  return (
    Date.parse(seen) === Date.parse(updatedAt) &&
    (facts === undefined ||
      ownValue(state.seenFacts ?? {}, id) === undefined ||
      ownValue(state.seenFacts ?? {}, id) === facts)
  );
}

/**
 * Drops snoozes that have ended and, when `knownIds` is given, every entry for a PR that is
 * not in it (pass the ids of the current snapshot). Returns `state` when nothing is dropped.
 */
export function pruneExpired(
  state: PrLocalState,
  now: Date | number,
  knownIds?: Iterable<string>,
): PrLocalState {
  const nowMs = toMillis(now);
  const known = knownIds === undefined ? null : new Set(knownIds);
  const tracked = (id: string) => known === null || known.has(id);
  const snoozed = filterRecord(
    state.snoozed,
    (id, until) => tracked(id) && Date.parse(until) > nowMs,
  );
  const muted = filterRecord(state.muted, tracked);
  const seen = filterRecord(state.seen, tracked);
  const seenFacts = state.seenFacts && filterRecord(state.seenFacts, tracked);
  const alwaysShown = state.alwaysShown && filterRecord(state.alwaysShown, tracked);
  if (
    snoozed === state.snoozed &&
    muted === state.muted &&
    seen === state.seen &&
    seenFacts === state.seenFacts &&
    alwaysShown === state.alwaysShown
  )
    return state;
  return {
    ...state,
    snoozed,
    muted,
    seen,
    ...(seenFacts ? { seenFacts } : {}),
    ...(alwaysShown ? { alwaysShown } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Storage

/** The stored local PR state, normalized (empty when nothing is stored yet). */
export async function loadPrLocal(): Promise<PrLocalState> {
  return normalizePrLocal(await getItem(STORAGE_KEYS.prLocal));
}

/** Drop observed PR content at a session boundary, retaining the user's local choices. */
export async function forgetSeenFacts(): Promise<void> {
  if (!(await getItem('prLocal'))?.seenFacts) return;
  await updatePrLocal((state) => {
    const { seenFacts: _facts, ...choices } = state;
    return choices;
  });
}

/**
 * Applies `update` to the stored state and stores the result (serialized with other updates,
 * skipped when nothing changed). Returns the state now stored.
 */
export async function updatePrLocal(
  update: (current: PrLocalState) => PrLocalState,
): Promise<PrLocalState> {
  return updateItem(STORAGE_KEYS.prLocal, (stored) => update(normalizePrLocal(stored)));
}

/** Calls `listener` with the normalized state whenever it changes in any context. */
export function subscribePrLocal(listener: (state: PrLocalState) => void): Unsubscribe {
  return subscribe(STORAGE_KEYS.prLocal, (value) => listener(normalizePrLocal(value)));
}
