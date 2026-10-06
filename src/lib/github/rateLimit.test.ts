import { describe, expect, it } from 'vitest';
import { graphqlRateLimit, rateLimitHeaders } from '../../../tests/fixtures/http';
import { headerCount, parseRateLimit, resetAtFromHeaders } from './rateLimit';

const headers = (values: Record<string, string>) => new Headers(values);

describe('parseRateLimit from headers', () => {
  it('reads limit, remaining and reset (epoch seconds)', () => {
    expect(
      parseRateLimit(headers(rateLimitHeaders({ remaining: 12, reset: 1_791_295_200 }))),
    ).toEqual({ limit: 5000, remaining: 12, resetAt: '2026-10-06T14:00:00.000Z' });
  });

  it('is null unless all three headers are valid', () => {
    const valid = rateLimitHeaders();
    for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
      expect(parseRateLimit(headers({ ...valid, [name]: '' }))).toBeNull();
      expect(parseRateLimit(headers({ ...valid, [name]: 'soon' }))).toBeNull();
      expect(parseRateLimit(headers({ ...valid, [name]: '-1' }))).toBeNull();
      expect(parseRateLimit(headers({ ...valid, [name]: '1.5' }))).toBeNull();
    }
    expect(parseRateLimit(headers({}))).toBeNull();
  });

  it('is null when the reset is outside the date range', () => {
    expect(parseRateLimit(headers(rateLimitHeaders({ reset: 9e15 })))).toBeNull();
  });
});

describe('parseRateLimit from the GraphQL rateLimit object', () => {
  it('reads limit, remaining and resetAt, ignoring cost', () => {
    expect(parseRateLimit(graphqlRateLimit({ remaining: 7 }))).toEqual({
      limit: 5000,
      remaining: 7,
      resetAt: '2026-10-06T13:00:00.000Z',
    });
  });

  it('is null for missing or invalid fields and non-objects', () => {
    expect(parseRateLimit({ ...graphqlRateLimit(), limit: undefined })).toBeNull();
    expect(parseRateLimit({ ...graphqlRateLimit(), remaining: -3 })).toBeNull();
    expect(parseRateLimit({ ...graphqlRateLimit(), resetAt: 'tomorrow' })).toBeNull();
    expect(parseRateLimit({ ...graphqlRateLimit(), resetAt: 1_791_295_200 })).toBeNull();
    expect(parseRateLimit(null)).toBeNull();
    expect(parseRateLimit(undefined)).toBeNull();
    expect(parseRateLimit('5000')).toBeNull();
  });
});

describe('header helpers', () => {
  it('headerCount parses non-negative integers only', () => {
    expect(headerCount(headers({ 'retry-after': '30' }), 'retry-after')).toBe(30);
    expect(headerCount(headers({ 'retry-after': '0' }), 'retry-after')).toBe(0);
    expect(headerCount(headers({ 'retry-after': 'Wed, 21 Oct 2026' }), 'retry-after')).toBeNull();
    expect(headerCount(headers({}), 'retry-after')).toBeNull();
  });

  it('resetAtFromHeaders works without the other headers', () => {
    expect(resetAtFromHeaders(headers({ 'x-ratelimit-reset': '1791295200' }))).toBe(
      '2026-10-06T14:00:00.000Z',
    );
    expect(resetAtFromHeaders(headers({}))).toBeNull();
  });
});
