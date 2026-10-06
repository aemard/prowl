import { describe, expect, it } from 'vitest';
import { classifyGraphQLType, classifyHttpStatus, GitHubError } from './errors';

describe('GitHubError', () => {
  it('defaults the optional fields to null', () => {
    const error = new GitHubError('network', 'offline');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GitHubError');
    expect(error.toString()).toBe('GitHubError: offline');
    expect([error.status, error.resetAt, error.retryAfterSeconds]).toEqual([null, null, null]);
  });

  it('carries status, resetAt and retryAfterSeconds', () => {
    const error = new GitHubError('rate_limited', 'slow down', {
      status: 403,
      resetAt: '2026-10-06T13:00:00.000Z',
      retryAfterSeconds: 60,
    });
    expect([error.kind, error.status, error.resetAt, error.retryAfterSeconds]).toEqual([
      'rate_limited',
      403,
      '2026-10-06T13:00:00.000Z',
      60,
    ]);
  });
});

describe('classifyHttpStatus', () => {
  const plain = { limited: false, message: '' };

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [404, 'not_found'],
    [410, 'not_found'],
    [451, 'forbidden'],
    [400, 'validation'],
    [409, 'validation'],
    [422, 'validation'],
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
    [304, 'server'],
  ] as const)('%i is %s', (status, kind) => {
    expect(classifyHttpStatus(status, plain)).toBe(kind);
  });

  it('a 403 is a rate limit when the budget is exhausted or retry-after was sent', () => {
    expect(classifyHttpStatus(403, { limited: true, message: '' })).toBe('rate_limited');
  });

  it('a 403 is a secondary rate limit when the message says so', () => {
    const secondary = 'You have exceeded a secondary rate limit. Please wait a few minutes.';
    expect(classifyHttpStatus(403, { limited: false, message: secondary })).toBe('rate_limited');
    const abuse = 'You have triggered an abuse detection mechanism.';
    expect(classifyHttpStatus(403, { limited: false, message: abuse })).toBe('rate_limited');
  });

  it('only 403 looks at the rate-limit signals', () => {
    expect(classifyHttpStatus(404, { limited: true, message: 'rate limit' })).toBe('not_found');
  });
});

describe('classifyGraphQLType', () => {
  it.each([
    ['RATE_LIMITED', 'rate_limited'],
    ['FORBIDDEN', 'forbidden'],
    ['INSUFFICIENT_SCOPES', 'forbidden'],
    ['NOT_FOUND', 'not_found'],
    ['UNPROCESSABLE', 'validation'],
    ['MAX_NODE_LIMIT_EXCEEDED', 'graphql'],
    [undefined, 'graphql'],
    [42, 'graphql'],
  ] as const)('%s is %s', (type, kind) => {
    expect(classifyGraphQLType(type)).toBe(kind);
  });
});
