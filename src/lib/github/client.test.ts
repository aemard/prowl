import { expect, it, vi } from 'vitest';
import {
  graphqlError,
  graphqlRateLimit,
  jsonResponse,
  rateLimitHeaders,
} from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';
import { API, failure, fields, setup, TOKEN } from './client.test-support';

it('graphql posts the query to /graphql and returns data', async () => {
  const { client, fetch } = setup(jsonResponse({ data: { viewer: { login: 'octocat' } } }));
  const data = await client.graphql<{ viewer: { login: string } }>('query V { viewer { login } }', {
    first: 5,
  });
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
  expect(init?.credentials).toBe('omit');
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it('graphql sends empty variables by default and tolerates a trailing slash in apiUrl', async () => {
  const fetch = vi.fn<FetchLike>(async () => jsonResponse({ data: {} }));
  const client = createGitHubClient({ token: TOKEN, apiUrl: `${API}//`, fetch });
  await client.graphql('query V { viewer { login } }');
  expect(fetch.mock.calls[0]?.[0]).toBe(`${API}/graphql`);
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body)).variables).toEqual({});
});

it('graphql uses the global fetch, looked up on every call, when none is injected', async () => {
  const fetch = vi.fn(async () => jsonResponse({ data: { ok: true } }));
  const client = createGitHubClient({ token: TOKEN, apiUrl: API });
  vi.stubGlobal('fetch', fetch);
  expect(await client.graphql('query V { ok }')).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledOnce();
});

it('graphql exposes the rateLimit object selected by the query', async () => {
  const rateLimit = graphqlRateLimit();
  const { client } = setup(jsonResponse({ data: { rateLimit } }));
  expect(await client.graphql('query V { rateLimit { limit } }')).toEqual({ rateLimit });
});

it.each([
  ['NOT_FOUND', 'not_found'],
  ['FORBIDDEN', 'forbidden'],
  ['INSUFFICIENT_SCOPES', 'forbidden'],
  ['UNPROCESSABLE', 'validation'],
  ['MAX_NODE_LIMIT_EXCEEDED', 'graphql'],
  [undefined, 'graphql'],
] as const)('graphql errors array maps type %s to %s', async (type, kind) => {
  const body = { data: null, errors: [graphqlError(type, 'It broke')] };
  const { client } = setup(jsonResponse(body));
  const error = await failure(client.graphql('query V { x }'));
  expect(fields(error)).toEqual([kind, 200, null, null]);
  expect(error.message).toBe('It broke');
});

it('graphql errors array maps RATE_LIMITED to rate_limited with the reset from the headers', async () => {
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

it('graphql errors array reports the first error', async () => {
  const body = {
    errors: [graphqlError('NOT_FOUND', 'first'), graphqlError('FORBIDDEN', 'second')],
  };
  const { client } = setup(jsonResponse(body));
  const error = await failure(client.graphql('query V { x }'));
  expect([error.kind, error.message]).toEqual(['not_found', 'first']);
});

it('graphql errors array falls back to a generic message and ignores malformed entries', async () => {
  for (const errors of [[{}], [{ message: '' }], [{ message: 42 }], ['boom'], [null]]) {
    const { client } = setup(jsonResponse({ data: null, errors }));
    const error = await failure(client.graphql('query V { x }'));
    expect([error.kind, error.message]).toEqual(['graphql', 'GitHub returned an error.']);
  }
});

it('graphql errors array is strict by default: partial data with errors throws', async () => {
  const body = {
    data: { nodes: [null] },
    errors: [graphqlError('NOT_FOUND', 'gone', ['nodes', 0])],
  };
  const { client } = setup(jsonResponse(body));
  expect((await failure(client.graphql('query V { x }'))).kind).toBe('not_found');
});

it('graphql errors array returns partial data when asked to', async () => {
  const body = {
    data: { nodes: [null, { id: 'a' }] },
    errors: [graphqlError('NOT_FOUND', 'gone')],
  };
  const { client } = setup(jsonResponse(body));
  expect(await client.graphql('query V { x }', {}, { partial: true })).toEqual({
    nodes: [null, { id: 'a' }],
  });
});

it('graphql errors array hands the partial errors over, with the token masked, when asked to', async () => {
  const body = {
    data: { nodes: [null, null, { id: 'a' }] },
    errors: [
      graphqlError('FORBIDDEN', `Resource protected by SAML enforcement for ${TOKEN}`),
      graphqlError('NOT_FOUND', 'gone'),
      'not an error object',
    ],
  };
  const { client } = setup(jsonResponse(body));
  const onPartialErrors = vi.fn();
  await client.graphql('query V { x }', {}, { partial: true, onPartialErrors });
  expect(onPartialErrors).toHaveBeenCalledExactlyOnceWith([
    'Resource protected by SAML enforcement for [redacted]',
    'gone',
  ]);
  onPartialErrors.mockClear();
  const clean = setup(jsonResponse({ data: { nodes: [] } }));
  await clean.client.graphql('query V { x }', {}, { partial: true, onPartialErrors });
  expect(onPartialErrors).not.toHaveBeenCalled();
});

it('graphql errors array still throws in partial mode when there is no data at all', async () => {
  const body = { data: null, errors: [graphqlError('FORBIDDEN', 'SAML enforcement')] };
  const { client } = setup(jsonResponse(body));
  const error = await failure(client.graphql('query V { x }', {}, { partial: true }));
  expect([error.kind, error.message]).toEqual(['forbidden', 'SAML enforcement']);
});

it('graphql errors array treats an empty errors array as success', async () => {
  const { client } = setup(jsonResponse({ data: { ok: true }, errors: [] }));
  expect(await client.graphql('query V { x }')).toEqual({ ok: true });
});

it.each([
  ['no data and no errors', jsonResponse({})],
  ['null data', jsonResponse({ data: null })],
  ['errors that is not an array', jsonResponse({ errors: 'nope' })],
  ['a non-object payload', jsonResponse([1, 2])],
  ['an empty body', jsonResponse(undefined)],
  ['invalid JSON', new Response('<html>oops</html>', { status: 200 })],
])('graphql unusable 200 responses are server errors %s', async (_name, response) => {
  const { client } = setup(response);
  const error = await failure(client.graphql('query V { x }'));
  expect([error.kind, error.status]).toEqual(['server', 200]);
});

it('rest sends the version header and no body for a GET', async () => {
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

it('rest sends a JSON body', async () => {
  const { client, fetch } = setup(jsonResponse({}, { status: 201 }));
  await client.rest('POST', '/repos/o/r/actions/runs/1/rerun-failed-jobs', { enable: true });
  const init = fetch.mock.calls[0]?.[1];
  expect(init?.body).toBe('{"enable":true}');
  expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
});

it('rest resolves to undefined when the body is empty', async () => {
  const { client } = setup(new Response(null, { status: 204 }));
  expect(await client.rest('DELETE', '/repos/o/r/thing')).toBeUndefined();
});

it('rest rejects a success response that is not JSON', async () => {
  const { client } = setup(new Response('<html>', { status: 200 }));
  expect(fields(await failure(client.rest('GET', '/user')))).toEqual(['server', 200, null, null]);
});

it('rest restResponse also returns the response headers', async () => {
  const { client } = setup(
    jsonResponse({ login: 'octocat' }, { headers: { 'x-oauth-scopes': 'repo, read:org' } }),
  );
  const { data, headers } = await client.restResponse<{ login: string }>('GET', '/user');
  expect(data).toEqual({ login: 'octocat' });
  expect(headers.get('x-oauth-scopes')).toBe('repo, read:org');
});
