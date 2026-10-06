import { describe, expect, it } from 'vitest';
import type { ErrorKind } from '../model';
import {
  backoffDelay,
  isWaiting,
  MAX_BACKOFF_MS,
  MAX_WAIT_MS,
  rateLimitedUntil,
  retryAt,
} from './backoff';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const MINUTE = 60_000;

describe('backoffDelay', () => {
  it('doubles the interval with every failure, up to 30 minutes', () => {
    const noJitter = () => 0;
    expect([1, 2, 3, 4, 10, 2000].map((n) => backoffDelay(2, n, noJitter))).toEqual([
      4 * MINUTE,
      8 * MINUTE,
      16 * MINUTE,
      MAX_BACKOFF_MS,
      MAX_BACKOFF_MS,
      MAX_BACKOFF_MS,
    ]);
  });

  it('takes off up to a quarter as jitter', () => {
    expect(backoffDelay(1, 1, () => 0.999_999)).toBe(1.5 * MINUTE);
    expect(backoffDelay(1, 1, () => 0.5)).toBe(1.75 * MINUTE);
    const random = backoffDelay(5, 3);
    expect(random).toBeGreaterThan(30 * MINUTE * 0.75);
    expect(random).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });
});

describe('rateLimitedUntil', () => {
  const reset = '2026-10-06T12:20:00.000Z';

  it('waits for the later of the reset and retry-after', () => {
    expect(rateLimitedUntil(NOW, { resetAt: reset, retryAfterSeconds: 60 })).toBe(
      Date.parse(reset),
    );
    expect(rateLimitedUntil(NOW, { resetAt: reset, retryAfterSeconds: 1800 })).toBe(
      NOW + 30 * MINUTE,
    );
    expect(rateLimitedUntil(NOW, { resetAt: null, retryAfterSeconds: 60 })).toBe(NOW + MINUTE);
    expect(rateLimitedUntil(NOW, { resetAt: reset, retryAfterSeconds: null })).toBe(
      Date.parse(reset),
    );
  });

  it('never waits more than an hour, and gives null without any hint', () => {
    expect(rateLimitedUntil(NOW, { resetAt: null, retryAfterSeconds: 86_400 })).toBe(
      NOW + MAX_WAIT_MS,
    );
    expect(rateLimitedUntil(NOW, { resetAt: null, retryAfterSeconds: null })).toBeNull();
    expect(rateLimitedUntil(NOW, { resetAt: 'soon', retryAfterSeconds: null })).toBeNull();
  });
});

describe('isWaiting', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();

  it('is true until the time has come', () => {
    expect(isWaiting(null, NOW)).toBe(false);
    expect(isWaiting(at(MINUTE), NOW)).toBe(true);
    expect(isWaiting(at(MAX_WAIT_MS), NOW)).toBe(true);
    expect(isWaiting(at(0), NOW)).toBe(false);
    expect(isWaiting(at(-MINUTE), NOW)).toBe(false);
  });

  it('ignores a wait no poll could have set (the clock went back)', () => {
    expect(isWaiting(at(MAX_WAIT_MS + 1), NOW)).toBe(false);
    expect(isWaiting(at(24 * 60 * MINUTE), NOW)).toBe(false);
  });
});

describe('retryAt', () => {
  const failure = (kind: ErrorKind, resetAt: string | null = null) => ({
    kind,
    resetAt,
    retryAfterSeconds: null,
  });
  const noJitter = () => 0;

  it('backs off, waits for a rate limit and stops for a rejected token', () => {
    expect(retryAt(NOW, failure('network'), 2, 1, noJitter)).toBe(NOW + 4 * MINUTE);
    expect(retryAt(NOW, failure('server'), 2, 3, noJitter)).toBe(NOW + 16 * MINUTE);
    const reset = '2026-10-06T12:40:00.000Z';
    expect(retryAt(NOW, failure('rate_limited', reset), 2, 1, noJitter)).toBe(Date.parse(reset));
    expect(retryAt(NOW, failure('rate_limited'), 2, 1, noJitter)).toBe(NOW + 4 * MINUTE);
    expect(retryAt(NOW, failure('unauthorized'), 2, 1, noJitter)).toBeNull();
  });
});
