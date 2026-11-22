/**
 * What quiet hours hold for their digest, kept in `chrome.storage.local` (`quietHeld`) so a night
 * with Chrome closed does not lose it. Pure: the notifier reads and writes the list.
 */
import type { HeldEvent, PrEvent } from '../model';

/** Events kept for the digest; older ones are dropped first. */
export const MAX_HELD = 50;
/** A held event older than this is stale news: the digest leaves it out. */
export const HELD_TTL_MS = 24 * 60 * 60 * 1000;

const isHeldEvent = (value: unknown): value is HeldEvent =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as HeldEvent).heldAt === 'string' &&
  typeof (value as HeldEvent).event?.id === 'string';

/** The stored list without what is malformed or older than `HELD_TTL_MS` at `now`. */
export function freshHeld(stored: unknown, now: number): HeldEvent[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isHeldEvent).filter(({ heldAt }) => now - Date.parse(heldAt) < HELD_TTL_MS);
}

/** `held` plus the `events` it does not have yet, held at `now`; the newest `MAX_HELD`. */
export function holdEvents(held: HeldEvent[], events: PrEvent[], now: number): HeldEvent[] {
  const ids = new Set(held.map(({ event }) => event.id));
  const heldAt = new Date(now).toISOString();
  const added = events.filter(({ id }) => !ids.has(id)).map((event) => ({ event, heldAt }));
  return [...held, ...added].slice(-MAX_HELD);
}
