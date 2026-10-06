import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  graphqlError,
  graphqlRateLimit,
  jsonResponse,
  rateLimitHeaders,
} from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';

const TOKEN = 'ghp_SecretTokenValue0123456789abcdefABCD';
const API = 'https://api.github.com';

function setup(...responses: (Response | Error)[]) {
  const fetch = vi.fn<FetchLike>(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch, client: createGitHubClient({ token: TOKEN, apiUrl: API, fetch }) };
}

async function failure(promise: Promise<unknown>): Promise<GitHubError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(GitHubError);
  return error as GitHubError;
}

const fields = (e: GitHubError) => [e.kind, e.status, e.resetAt, e.retryAfterSeconds];

afterEach(() => {
  vi.useRealTimers();
});

describe('graphql', () => {
  it('posts the query to /graphql and returns data', async () => {
    const { client, fetch } = setup(jsonResponse({ data: { viewer: { login: 'octocat' } } }));
    const data = await client.graphql<{ viewer: { login: string } }>(
      'query V { viewer { login } }',
      {
        first: 5,
      },
    );
    expect(data).toEqual({ viewer: { login: 'octocat' } });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${API}/graphql`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'query V { viewer { login } }',
      variables: { first: 5 },
    });
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    });
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends empty variables by default and tolerates a trailing slash in apiUrl', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ data: {} }));
    const client = createGitHubClient({ token: TOKEN, apiUrl: `${API}//`, fetch });
    await client.graphql('query V { viewer { login } }');
    expect(fetch.mock.calls[0]?.[0]).toBe(`${API}/graphql`);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body)).variables).toEqual({});
  });

  it('uses the global fetch, looked up on every call, when none is injected', async () => {
    const fetch = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    const client = createGitHubClient({ token: TOKEN, apiUrl: API });
    vi.stubGlobal('fetch', fetch);
    expect(await client.graphql('query V { ok }')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('exposes the rateLimit object selected by the query', async () => {
    const rateLimit = graphqlRateLimit();
    const { client } = setup(jsonResponse({ data: { rateLimit } }));
    expect(await client.graphql('query V { rateLimit { limit } }')).toEqual({ rateLimit });
  });

  describe('errors array', () => {
    it.each([
      ['NOT_FOUND', 'not_found'],
      ['FORBIDDEN', 'forbidden'],
      ['INSUFFICIENT_SCOPES', 'forbidden'],
      ['UNPROCESSABLE', 'validation'],
      ['MAX_NODE_LIMIT_EXCEEDED', 'graphql'],
      [undefined, 'graphql'],
    ] as const)('maps type %s to %s', async (type, kind) => {
      const body = { data: null, errors: [graphqlError(type, 'It broke')] };
      const { client } = setup(jsonResponse(body));
      const error = await failure(client.graphql('query V { x }'));
      expect(fields(error)).toEqual([kind, 200, null, null]);
      expect(error.message).toBe('It broke');
    });

    it('maps RATE_LIMITED to rate_limited with the reset from the headers', async () => {
      const body = { errors: [graphqlError('RATE_LIMITED', 'API rate limit exceeded')] };
      const headers = rateLimitHeaders({ remaining: 0, reset: 1_791_295_200 });
      const { client } = setup(jsonResponse(body, { headers }));
      expect(fields(await failure(client.graphql('query V { x }')))).toEqual([
        'rate_limited',
        200,
        '2026-10-06T14:00:00.000Z',
        null,
      ]);
    });

    it('reports the first error', async () => {
      const body = {
        errors: [graphqlError('NOT_FOUND', 'first'), graphqlError('FORBIDDEN', 'second')],
      };
      const { client } = setup(jsonResponse(body));
      const error = await failure(client.graphql('query V { x }'));
      expect([error.kind, error.message]).toEqual(['not_found', 'first']);
    });

    it('falls back to a generic message and ignores malformed entries', async () => {
      for (const errors of [[{}], [{ message: '' }], [{ message: 42 }], ['boom'], [null]]) {
        const { client } = setup(jsonResponse({ data: null, errors }));
        const error = await failure(client.graphql('query V { x }'));
        expect([error.kind, error.message]).toEqual(['graphql', 'GitHub returned an error.']);
      }
    });

    it('is strict by default: partial data with errors throws', async () => {
      const body = {
        data: { nodes: [null] },
        errors: [graphqlError('NOT_FOUND', 'gone', ['nodes', 0])],
      };
      const { client } = setup(jsonResponse(body));
      expect((await failure(client.graphql('query V { x }'))).kind).toBe('not_found');
    });

    it('returns partial data when asked to', async () => {
      const body = {
        data: { nodes: [null, { id: 'a' }] },
        errors: [graphqlError('NOT_FOUND', 'gone')],
      };
      const { client } = setup(jsonResponse(body));
      expect(await client.graphql('query V { x }', {}, { partial: true })).toEqual({
        nodes: [null, { id: 'a' }],
      });
    });

    it('still throws in partial mode when there is no data at all', async () => {
      const body = { data: null, errors: [graphqlError('FORBIDDEN', 'SAML enforcement')] };
      const { client } = setup(jsonResponse(body));
      const error = await failure(client.graphql('query V { x }', {}, { partial: true }));
      expect([error.kind, error.message]).toEqual(['forbidden', 'SAML enforcement']);
    });

    it('treats an empty errors array as success', async () => {
      const { client } = setup(jsonResponse({ data: { ok: true }, errors: [] }));
      expect(await client.graphql('query V { x }')).toEqual({ ok: true });
    });
  });

  describe('unusable 200 responses are server errors', () => {
    it.each([
      ['no data and no errors', jsonResponse({})],
      ['null data', jsonResponse({ data: null })],
      ['errors that is not an array', jsonResponse({ errors: 'nope' })],
      ['a non-object payload', jsonResponse([1, 2])],
      ['an empty body', jsonResponse(undefined)],
      ['invalid JSON', new Response('<html>oops</html>', { status: 200 })],
    ])('%s', async (_name, response) => {
      const { client } = setup(response);
      const error = await failure(client.graphql('query V { x }'));
      expect([error.kind, error.status]).toEqual(['server', 200]);
    });
  });
});

describe('rest', () => {
  it('sends the version header and no body for a GET', async () => {
    const { client, fetch } = setup(jsonResponse({ login: 'octocat' }));
    expect(await client.rest<{ login: string }>('GET', '/user')).toEqual({ login: 'octocat' });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${API}/user`);
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('sends a JSON body', async () => {
    const { client, fetch } = setup(jsonResponse({}, { status: 201 }));
    await client.rest('POST', '/repos/o/r/actions/runs/1/rerun-failed-jobs', { enable: true });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"enable":true}');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('resolves to undefined when the body is empty', async () => {
    const { client } = setup(new Response(null, { status: 204 }));
    expect(await client.rest('DELETE', '/repos/o/r/thing')).toBeUndefined();
  });

  it('rejects a success response that is not JSON', async () => {
    const { client } = setup(new Response('<html>', { status: 200 }));
    expect(fields(await failure(client.rest('GET', '/user')))).toEqual(['server', 200, null, null]);
  });
});

describe('HTTP failures', () => {
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
  ] as const)('%s', async (_name, status, body, headers, expected) => {
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
  ] as const)('REST %i is %s', async (status, kind) => {
    const { client } = setup(jsonResponse({}, { status }));
    expect(fields(await failure(client.rest('GET', '/x')))).toEqual([kind, status, null, null]);
  });

  it('truncates very long messages', async () => {
    const { client } = setup(jsonResponse({ message: 'x'.repeat(5000) }, { status: 500 }));
    expect((await failure(client.rest('GET', '/x'))).message).toHaveLength(300);
  });
});

describe('network failures', () => {
  it('a rejected fetch is a network error', async () => {
    const { client } = setup(new TypeError('Failed to fetch'));
    const error = await failure(client.rest('GET', '/user'));
    expect(fields(error)).toEqual(['network', null, null, null]);
    expect(error.message).toBe('Could not reach GitHub.');
  });

  it('a body that fails to download is a network error', async () => {
    const broken = new Response('{}');
    vi.spyOn(broken, 'text').mockRejectedValue(new TypeError('terminated'));
    const { client } = setup(broken);
    expect((await failure(client.rest('GET', '/user'))).kind).toBe('network');
  });

  it('aborts after 20 seconds', async () => {
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

  it('clears the timeout once the response is read', async () => {
    vi.useFakeTimers();
    const { client } = setup(jsonResponse({ ok: true }), new TypeError('offline'));
    await client.rest('GET', '/a');
    expect(vi.getTimerCount()).toBe(0);
    await failure(client.rest('GET', '/b'));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the token never leaks', () => {
  const everything = (error: GitHubError) =>
    [
      error.message,
      error.toString(),
      error.stack,
      String(error.cause),
      JSON.stringify(error),
      inspect(error, { depth: 5 }),
    ].join('\n');

  it('masks it in messages GitHub sends back', async () => {
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

  it('masks every occurrence, even across the truncation boundary', async () => {
    const echo = `${'a'.repeat(280)}${TOKEN}${TOKEN}`;
    const { client } = setup(jsonResponse({ message: echo }, { status: 401 }));
    const error = await failure(client.rest('GET', '/user'));
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(TOKEN.slice(0, 12));
  });

  it('keeps it out of network errors and their cause', async () => {
    const thrown = new TypeError(`Failed to fetch with Authorization: Bearer ${TOKEN}`);
    const { client } = setup(thrown);
    const error = await failure(client.rest('GET', '/user'));
    expect(error.cause).toBeUndefined();
    expect(everything(error)).not.toContain(TOKEN);
  });

  it('keeps it out of timeout errors', async () => {
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

  it('handles an empty token without mangling messages', async () => {
    const client = createGitHubClient({
      token: '',
      apiUrl: API,
      fetch: async () => jsonResponse({ message: 'Requires authentication' }, { status: 401 }),
    });
    expect((await failure(client.rest('GET', '/user'))).message).toBe('Requires authentication');
  });
});
