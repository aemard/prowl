/** When the poller may try again: exponential backoff, rate-limit waits, clock sanity. Pure. */
import type { ErrorKind } from '../model';

const MINUTE = 60_000;
/** Longest backoff after failed polls. */
export const MAX_BACKOFF_MS = 30 * MINUTE;
/** Longest wait honoured at all: GitHub's primary rate limit resets within the hour. */
export const MAX_WAIT_MS = 60 * MINUTE;
/** Below this many points left, polls wait for the rate limit to reset. */
export const LOW_RATE_LIMIT = 100;

/**
 * Delay after `failures` consecutive failed polls: `interval × 2^failures`, capped at 30 min,
 * minus up to 25% jitter so clients that failed together do not retry together.
 */
export function backoffDelay(
  intervalMinutes: number,
  failures: number,
  random: () => number = Math.random,
): number {
  const delay = Math.min(MAX_BACKOFF_MS, intervalMinutes * MINUTE * 2 ** failures);
  return Math.round(delay * (1 - 0.25 * random()));
}

/**
 * Epoch ms when a rate-limited client may call again: the later of the reset of the exhausted
 * budget and `retry-after`, at most an hour away; null when GitHub gave neither.
 */
export function rateLimitedUntil(
  now: number,
  { resetAt, retryAfterSeconds }: { resetAt: string | null; retryAfterSeconds: number | null },
): number | null {
  const hints = [
    resetAt === null ? Number.NaN : Date.parse(resetAt),
    retryAfterSeconds === null ? Number.NaN : now + retryAfterSeconds * 1000,
  ].filter(Number.isFinite);
  return hints.length === 0 ? null : Math.min(Math.max(...hints), now + MAX_WAIT_MS);
}

/**
 * True while `until` (ISO) is in the future. A wait longer than `MAX_WAIT_MS` cannot have been
 * set by the poller, so the clock went back: it is ignored rather than stalling polls for hours.
 */
export function isWaiting(until: string | null, now: number): boolean {
  if (until === null) return false;
  const wait = Date.parse(until) - now;
  return wait > 0 && wait <= MAX_WAIT_MS;
}

/**
 * Epoch ms of the next attempt after a failed poll (`failures` in a row, this one included):
 * null for a rejected token (polling stops), the rate-limit wait for `rate_limited`, else the
 * backoff.
 */
export function retryAt(
  now: number,
  failure: { kind: ErrorKind; resetAt: string | null; retryAfterSeconds: number | null },
  intervalMinutes: number,
  failures: number,
  random: () => number = Math.random,
): number | null {
  if (failure.kind === 'unauthorized') return null;
  const backoff = now + backoffDelay(intervalMinutes, failures, random);
  return failure.kind === 'rate_limited' ? (rateLimitedUntil(now, failure) ?? backoff) : backoff;
}
