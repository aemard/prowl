import { inspect } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { graphqlError, jsonResponse, rateLimitHeaders } from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';
import { API, failure, fields, setup, TOKEN } from './client.test-support';
import type { GitHubError } from './errors';

afterEach(() => {
  vi.useRealTimers();
});

const reset = 1_791_295_200;

const resetIso = '2026-10-06T14:00:00.000Z';

const message = (text: string) => ({ message: text });

it.each([
  ['401', 401, message('Bad credentials'), {}, ['unauthorized', 401, null, null]],
  [
    '403 forbidden',
    403,
    message('Resource not accessible'),
    rateLimitHeaders(),
    ['forbidden', 403, null, null],
  ],
  ['404', 404, message('Not Found'), {}, ['not_found', 404, null, null]],
  ['422', 422, message('Validation Failed'), {}, ['validation', 422, null, null]],
  ['500', 500, message('Server Error'), {}, ['server', 500, null, null]],
  ['502 with an HTML body', 502, undefined, {}, ['server', 502, null, null]],
  [
    '503 with retry-after',
    503,
    message('Unavailable'),
    { 'retry-after': '30' },
    ['server', 503, null, 30],
  ],
  [
    '403 primary rate limit',
    403,
    message('API rate limit exceeded for user ID 1.'),
    rateLimitHeaders({ remaining: 0, reset }),
    ['rate_limited', 403, resetIso, null],
  ],
  [
    '429 primary rate limit',
    429,
    message('API rate limit exceeded'),
    rateLimitHeaders({ remaining: 0, reset }),
    ['rate_limited', 429, resetIso, null],
  ],
  [
    '403 with retry-after (secondary)',
    403,
    message('Please wait a few minutes before you try again.'),
    { ...rateLimitHeaders(), 'retry-after': '120' },
    ['rate_limited', 403, null, 120],
  ],
  [
    '403 secondary message without headers',
    403,
    message('You have exceeded a secondary rate limit.'),
    {},
    ['rate_limited', 403, null, 60],
  ],
  ['429 without headers', 429, undefined, {}, ['rate_limited', 429, null, 60]],
  [
    'exhausted budget with retry-after keeps both',
    403,
    message('Slow down'),
    { ...rateLimitHeaders({ remaining: 0, reset }), 'retry-after': '10' },
    ['rate_limited', 403, resetIso, 10],
  ],
  [
    'exhausted budget without a reset header',
    403,
    message('Slow down'),
    { 'x-ratelimit-remaining': '0' },
    ['rate_limited', 403, null, 60],
  ],
] as const)('HTTP failures %s', async (_name, status, body, headers, expected) => {
  const response = body
    ? jsonResponse(body, { status, headers })
    : new Response('<html>Bad gateway</html>', { status, headers });
  const { client } = setup(response);
  const error = await failure(client.graphql('query V { x }'));
  expect(fields(error)).toEqual(expected);
  expect(error.message).toBe(body?.message ?? `GitHub responded with HTTP ${status}.`);
});

it.each([
  [400, 'validation'],
  [409, 'validation'],
  [410, 'not_found'],
  [451, 'forbidden'],
  [304, 'server'],
] as const)('HTTP failures REST %i is %s', async (status, kind) => {
  const { client } = setup(jsonResponse({}, { status }));
  expect(fields(await failure(client.rest('GET', '/x')))).toEqual([kind, status, null, null]);
});

it('HTTP failures truncates very long messages', async () => {
  const { client } = setup(jsonResponse({ message: 'x'.repeat(5000) }, { status: 500 }));
  expect((await failure(client.rest('GET', '/x'))).message).toHaveLength(300);
});

it('network failures a rejected fetch is a network error', async () => {
  const { client } = setup(new TypeError('Failed to fetch'));
  const error = await failure(client.rest('GET', '/user'));
  expect(fields(error)).toEqual(['network', null, null, null]);
  expect(error.message).toBe('Could not reach GitHub.');
});

it('network failures a body that fails to download is a network error', async () => {
  const broken = new Response('{}');
  vi.spyOn(broken, 'text').mockRejectedValue(new TypeError('terminated'));
  const { client } = setup(broken);
  expect((await failure(client.rest('GET', '/user'))).kind).toBe('network');
});

it('network failures aborts after 20 seconds', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<FetchLike>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  const client = createGitHubClient({ token: TOKEN, apiUrl: API, fetch });
  const pending = failure(client.graphql('query V { x }'));

  await vi.advanceTimersByTimeAsync(19_999);
  expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const error = await pending;
  expect(fields(error)).toEqual(['network', null, null, null]);
  expect(error.message).toBe('GitHub did not respond within 20 seconds.');
});

it('network failures clears the timeout once the response is read', async () => {
  vi.useFakeTimers();
  const { client } = setup(jsonResponse({ ok: true }), new TypeError('offline'));
  await client.rest('GET', '/a');
  expect(vi.getTimerCount()).toBe(0);
  await failure(client.rest('GET', '/b'));
  expect(vi.getTimerCount()).toBe(0);
});

const everything = (error: GitHubError) =>
  [
    error.message,
    error.toString(),
    error.stack,
    String(error.cause),
    JSON.stringify(error),
    inspect(error, { depth: 5 }),
  ].join('\n');

it('the token never leaks masks it in messages GitHub sends back', async () => {
  const echo = `Bad credentials for ${TOKEN}`;
  for (const response of [
    jsonResponse({ message: echo }, { status: 401 }),
    jsonResponse({ errors: [graphqlError('FORBIDDEN', echo)] }),
  ]) {
    const { client } = setup(response);
    const error = await failure(client.graphql('query V { x }'));
    expect(error.message).toBe('Bad credentials for [redacted]');
    expect(everything(error)).not.toContain(TOKEN);
  }
});

it('the token never leaks masks every occurrence, even across the truncation boundary', async () => {
  const echo = `${'a'.repeat(280)}${TOKEN}${TOKEN}`;
  const { client } = setup(jsonResponse({ message: echo }, { status: 401 }));
  const error = await failure(client.rest('GET', '/user'));
  expect(error.message).not.toContain(TOKEN);
  expect(error.message).not.toContain(TOKEN.slice(0, 12));
});

it('the token never leaks keeps it out of network errors and their cause', async () => {
  const thrown = new TypeError(`Failed to fetch with Authorization: Bearer ${TOKEN}`);
  const { client } = setup(thrown);
  const error = await failure(client.rest('GET', '/user'));
  expect(error.cause).toBeUndefined();
  expect(everything(error)).not.toContain(TOKEN);
});

it('the token never leaks keeps it out of timeout errors', async () => {
  vi.useFakeTimers();
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error(`aborted ${TOKEN}`)));
    });
  const client = createGitHubClient({ token: TOKEN, apiUrl: API, fetch });
  const pending = failure(client.rest('GET', '/user'));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(everything(await pending)).not.toContain(TOKEN);
});

it('the token never leaks handles an empty token without mangling messages', async () => {
  const client = createGitHubClient({
    token: '',
    apiUrl: API,
    fetch: async () => jsonResponse({ message: 'Requires authentication' }, { status: 401 }),
  });
  expect((await failure(client.rest('GET', '/user'))).message).toBe('Requires authentication');
});
