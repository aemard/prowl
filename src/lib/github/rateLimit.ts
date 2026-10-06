/**
 * Rate-limit parsing. GitHub reports the budget twice: in `x-ratelimit-*` response headers
 * (REST and GraphQL) and, when the query selects it, in the GraphQL `rateLimit` object.
 */
import type { RateLimit } from '../model';

type HeaderSource = Pick<Headers, 'get'>;

/** A non-negative integer from a number or a numeric string; anything else is null. */
function toCount(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Normalized ISO timestamp, or null when the time is out of range. */
function toIso(ms: number): string | null {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A non-negative integer header such as `x-ratelimit-remaining` or `retry-after`. */
export function headerCount(headers: HeaderSource, name: string): number | null {
  return toCount(headers.get(name));
}

/** `x-ratelimit-reset` (epoch seconds) as an ISO timestamp, or null when absent or invalid. */
export function resetAtFromHeaders(headers: HeaderSource): string | null {
  const seconds = headerCount(headers, 'x-ratelimit-reset');
  return seconds === null ? null : toIso(seconds * 1000);
}

function build(limit: number | null, remaining: number | null, resetAt: string | null) {
  return limit === null || remaining === null || resetAt === null
    ? null
    : ({ limit, remaining, resetAt } satisfies RateLimit);
}

/**
 * Reads the rate limit from response headers (`x-ratelimit-limit|remaining|reset`) or from a
 * GraphQL `rateLimit { limit remaining resetAt }` object. Returns null unless every field is
 * present and valid; `resetAt` is always a normalized ISO timestamp.
 */
export function parseRateLimit(source: unknown): RateLimit | null {
  if (typeof source !== 'object' || source === null) return null;
  if ('get' in source && typeof source.get === 'function') {
    const headers = source as HeaderSource;
    return build(
      headerCount(headers, 'x-ratelimit-limit'),
      headerCount(headers, 'x-ratelimit-remaining'),
      resetAtFromHeaders(headers),
    );
  }
  const { limit, remaining, resetAt } = source as Record<string, unknown>;
  return build(
    toCount(limit),
    toCount(remaining),
    typeof resetAt === 'string' ? toIso(Date.parse(resetAt)) : null,
  );
}
