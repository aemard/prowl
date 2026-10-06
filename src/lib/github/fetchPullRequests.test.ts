import { describe, expect, it, vi } from 'vitest';
import {
  closedNode,
  nodesResponse,
  prId,
  prNode,
  searchResponse,
} from '../../../tests/fixtures/github';
import {
  graphqlError,
  graphqlRateLimit,
  jsonResponse,
  rateLimitHeaders,
} from '../../../tests/fixtures/http';
import type { PullRequest, Section } from '../model';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';
import { type FetchSettings, fetchPullRequests } from './fetchPullRequests';
import { mapPullRequest } from './mapPullRequest';
import type { PullRequestNode } from './queries';

type Handler = (variables: Record<string, unknown>) => Response | Error | object;

/** A client whose fetch answers each GraphQL operation with `handlers[name]`. */
function setup(handlers: Record<string, Handler>) {
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const fetch = vi.fn<FetchLike>(async (_url, init) => {
    const { query, variables } = JSON.parse(String(init.body));
    const operation = /query (\w+)/.exec(query)?.[1] ?? '';
    calls.push({ operation, variables });
    const out = handlers[operation]?.(variables) ?? new Error(`unexpected ${operation}`);
    if (out instanceof Error) throw out;
    return out instanceof Response ? out : jsonResponse({ data: out });
  });
  const client = createGitHubClient({
    token: 'test-token',
    apiUrl: 'https://api.github.com',
    fetch,
  });
  const queries = () => calls.filter((c) => c.operation === 'ProwlSearch').map((c) => c.variables);
  return { client, calls, queries };
}

const section = (kind: Section['kind'], extra: Partial<Section> = {}): Section => ({
  id: kind,
  kind,
  label: kind,
  enabled: true,
  ...extra,
});

const settings = (overrides: Partial<FetchSettings> = {}): FetchSettings => ({
  sections: [section('authored')],
  repoInclude: [],
  repoExclude: [],
  maxPerSection: 50,
  ...overrides,
});

/** A search handler that serves `nodes` for queries containing each key. */
const bySearch =
  (results: Record<string, PullRequestNode[]>, rateLimit = graphqlRateLimit()) =>
  (variables: Record<string, unknown>) => {
    const key = Object.keys(results).find((k) => String(variables.query).includes(k));
    return searchResponse(key ? (results[key] ?? []) : [], variables, rateLimit);
  };

const mapped = (node: PullRequestNode) => mapPullRequest(node);

describe('fetchPullRequests', () => {
  it('searches each enabled section, most recently updated first, and dedupes PRs', async () => {
    const [a, b, c] = [prNode({ number: 1 }), prNode({ number: 2 }), prNode({ number: 3 })];
    const { client, queries } = setup({
      ProwlSearch: bySearch(
        { 'author:@me': [a, b], 'review-requested:@me': [b, c] },
        graphqlRateLimit({ remaining: 4321 }),
      ),
    });
    const result = await fetchPullRequests(
      client,
      settings({
        sections: [
          section('authored'),
          section('mentioned', { enabled: false }),
          section('review_requested'),
        ],
      }),
    );

    expect(queries()).toEqual([
      {
        query: 'is:pr is:open author:@me archived:false sort:updated-desc',
        first: 50,
        after: null,
      },
      {
        query: 'is:pr is:open review-requested:@me archived:false sort:updated-desc',
        first: 50,
        after: null,
      },
    ]);
    expect(result).toEqual({
      pullRequests: { [a.id]: mapped(a), [b.id]: mapped(b), [c.id]: mapped(c) },
      sections: { authored: [a.id, b.id], review_requested: [b.id, c.id] },
      sectionErrors: {},
      rateLimit: { limit: 5000, remaining: 4321, resetAt: '2026-10-06T13:00:00.000Z' },
    });
  });

  it('keeps the sort of a custom query and sends the repo filters', async () => {
    const { client, queries } = setup({ ProwlSearch: bySearch({}) });
    const custom = section('custom', { id: 'custom-1', query: 'label:bug sort:created-asc' });
    await fetchPullRequests(
      client,
      settings({ sections: [custom], repoInclude: ['acme'], repoExclude: ['acme/old'] }),
    );
    expect(queries()[0]?.query).toBe('is:pr label:bug sort:created-asc user:acme -repo:acme/old');
  });

  it('pages with the cursor up to maxPerSection', async () => {
    const nodes = Array.from({ length: 130 }, (_, i) => prNode({ number: i + 1 }));
    const { client, queries } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });

    const result = await fetchPullRequests(client, settings({ maxPerSection: 70 }));
    expect(queries().map(({ first, after }) => [first, after])).toEqual([
      [50, null],
      [20, '50'],
    ]);
    expect(result.sections.authored).toHaveLength(70);

    const fewer = setup({ ProwlSearch: bySearch({ 'author:@me': nodes.slice(0, 30) }) });
    const small = await fetchPullRequests(fewer.client, settings({ maxPerSection: 100 }));
    expect(fewer.queries()).toHaveLength(1);
    expect(small.sections.authored).toHaveLength(30);
  });

  it('dedupes a PR that moved between two pages', async () => {
    const pages = [prNode({ number: 1 }), prNode({ number: 2 })];
    const { client } = setup({
      ProwlSearch: ({ after }) => ({
        search: {
          pageInfo: { hasNextPage: after === null, endCursor: 'next' },
          nodes: after === null ? pages : [pages[1]],
        },
        rateLimit: null,
      }),
    });
    const result = await fetchPullRequests(client, settings({ maxPerSection: 100 }));
    expect(result.sections.authored).toEqual([prId(1), prId(2)]);
    expect(result.rateLimit).toBeNull();
  });

  it('applies the repo filters client-side', async () => {
    const kept = prNode({ number: 1, repository: 'acme/api' });
    const dropped = prNode({ number: 2, repository: 'acme/legacy' });
    const { client } = setup({ ProwlSearch: bySearch({ 'author:@me': [kept, dropped] }) });
    const result = await fetchPullRequests(client, settings({ repoExclude: ['acme/legacy'] }));
    expect(Object.keys(result.pullRequests)).toEqual([kept.id]);
    expect(result.sections.authored).toEqual([kept.id]);
  });

  it('skips holes left by partial errors and non-PR results', async () => {
    const pr = prNode();
    const { client } = setup({
      ProwlSearch: () =>
        jsonResponse({
          data: {
            search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [null, {}, pr] },
            rateLimit: graphqlRateLimit(),
          },
          errors: [
            graphqlError('FORBIDDEN', 'Resource protected by organization SAML enforcement.', [
              'search',
              'nodes',
              0,
            ]),
          ],
        }),
    });
    const result = await fetchPullRequests(client, settings());
    expect(result.sections.authored).toEqual([pr.id]);
    const empty = setup({
      ProwlSearch: () => ({
        search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: null },
        rateLimit: null,
      }),
    });
    expect((await fetchPullRequests(empty.client, settings())).sections.authored).toEqual([]);
  });

  it('reports an invalid custom query without sending it', async () => {
    const pr = prNode();
    const { client, queries } = setup({ ProwlSearch: bySearch({ 'author:@me': [pr] }) });
    const result = await fetchPullRequests(
      client,
      settings({
        sections: [
          section('custom', { id: 'custom-1', query: 'is:issue' }),
          section('custom', { id: 'custom-2' }),
          section('authored'),
        ],
      }),
    );
    expect(queries()).toHaveLength(1);
    expect(result.sections).toEqual({ authored: [pr.id] });
    expect(result.sectionErrors['custom-1']).toMatch(/pull requests only/);
    expect(result.sectionErrors['custom-2']).toMatch(/Enter a GitHub search query/);
  });

  it.each([
    [
      'a 422',
      () => jsonResponse({ message: 'Validation Failed' }, { status: 422 }),
      'Validation Failed',
    ],
    ['a 404', () => jsonResponse({ message: 'Not Found' }, { status: 404 }), 'Not Found'],
    [
      'a GraphQL error',
      () => jsonResponse({ data: null, errors: [graphqlError(undefined, 'Bad search')] }),
      'Bad search',
    ],
  ])(
    'reports a custom section that GitHub refuses with %s and loads the others',
    async (_, refusal, message) => {
      const pr = prNode();
      const { client } = setup({
        ProwlSearch: (variables) =>
          String(variables.query).includes('label:bug')
            ? refusal()
            : searchResponse([pr], variables),
      });
      const result = await fetchPullRequests(
        client,
        settings({
          sections: [
            section('custom', { id: 'custom-1', query: 'label:bug' }),
            section('authored'),
          ],
        }),
      );
      expect(result.sectionErrors).toEqual({ 'custom-1': message });
      expect(result.sections).toEqual({ authored: [pr.id] });
    },
  );

  it.each([
    ['unauthorized', () => jsonResponse({ message: 'Bad credentials' }, { status: 401 })],
    [
      'rate_limited',
      () =>
        jsonResponse(
          { message: 'API rate limit exceeded' },
          { status: 403, headers: rateLimitHeaders({ remaining: 0 }) },
        ),
    ],
    [
      'rate_limited',
      () =>
        jsonResponse(
          { message: 'You have exceeded a secondary rate limit.' },
          { status: 403, headers: { 'retry-after': '30' } },
        ),
    ],
    ['server', () => jsonResponse({ message: 'Server Error' }, { status: 502 })],
    ['network', () => new TypeError('Failed to fetch')],
  ] as const)('throws %s even for a custom section', async (kind, failure) => {
    const { client } = setup({ ProwlSearch: failure });
    const custom = section('custom', { id: 'custom-1', query: 'label:bug' });
    const error = await fetchPullRequests(client, settings({ sections: [custom] })).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe(kind);
  });

  it('throws any failure of a preset section', async () => {
    const { client } = setup({
      ProwlSearch: () => jsonResponse({ message: 'Validation Failed' }, { status: 422 }),
    });
    await expect(fetchPullRequests(client, settings())).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  describe('PRs that left every section', () => {
    const still = mapped(prNode({ number: 1 }));
    const merged = mapped(prNode({ number: 2 }));
    const closed = mapped(prNode({ number: 3 }));
    const reopenable = mapped(prNode({ number: 4 }));
    const deleted = mapped(prNode({ number: 5 }));
    const done: PullRequest = { ...mapped(prNode({ number: 6 })), state: 'merged' };
    const excluded = mapped(prNode({ number: 7, repository: 'acme/legacy' }));
    const previous = {
      pullRequests: Object.fromEntries(
        [still, merged, closed, reopenable, deleted, done, excluded].map((pr) => [pr.id, pr]),
      ),
    };

    it('looks up open ones by id and keeps the merged and closed ones', async () => {
      const { client, calls } = setup({
        ProwlSearch: bySearch({ 'author:@me': [prNode({ number: 1 })] }),
        ProwlNodes: ({ ids }) =>
          nodesResponse(
            ids,
            [
              closedNode(merged.id, { by: 'hubot' }),
              closedNode(closed.id, { state: 'CLOSED', by: 'monalisa' }),
              closedNode(reopenable.id, { state: 'OPEN' }),
            ],
            graphqlRateLimit({ remaining: 4000 }),
          ),
      });
      const result = await fetchPullRequests(
        client,
        settings({ repoExclude: ['acme/legacy'] }),
        previous,
      );

      expect(calls.at(-1)).toEqual({
        operation: 'ProwlNodes',
        variables: { ids: [merged.id, closed.id, reopenable.id, deleted.id] },
      });
      expect(result.sections).toEqual({ authored: [still.id] });
      expect(Object.keys(result.pullRequests)).toEqual([still.id, merged.id, closed.id]);
      expect(result.pullRequests[merged.id]).toMatchObject({ state: 'merged', closedBy: 'hubot' });
      expect(result.pullRequests[closed.id]).toMatchObject({
        state: 'closed',
        closedBy: 'monalisa',
      });
      expect(result.rateLimit?.remaining).toBe(4000);
    });

    it('tolerates deleted PRs reported as partial errors', async () => {
      const { client } = setup({
        ProwlSearch: bySearch({}),
        ProwlNodes: () =>
          jsonResponse({
            data: { nodes: [null, closedNode(closed.id, { state: 'CLOSED' })], rateLimit: null },
            errors: [graphqlError('NOT_FOUND', 'Could not resolve to a node', ['nodes', 0])],
          }),
      });
      const result = await fetchPullRequests(client, settings(), {
        pullRequests: { [deleted.id]: deleted, [closed.id]: closed },
      });
      expect(Object.keys(result.pullRequests)).toEqual([closed.id]);
    });

    it('asks for at most 100 ids per query', async () => {
      const many = Array.from({ length: 150 }, (_, i) => mapped(prNode({ number: i + 1 })));
      const { client, calls } = setup({
        ProwlSearch: bySearch({}),
        ProwlNodes: ({ ids }) => nodesResponse(ids, []),
      });
      await fetchPullRequests(client, settings(), {
        pullRequests: Object.fromEntries(many.map((pr) => [pr.id, pr])),
      });
      const batches = calls.filter((c) => c.operation === 'ProwlNodes');
      expect(batches.map(({ variables }) => (variables.ids as string[]).length)).toEqual([100, 50]);
    });

    it('sends nothing when no section is enabled and nothing left', async () => {
      const { client, calls } = setup({});
      const result = await fetchPullRequests(client, settings({ sections: [] }), {
        pullRequests: { [done.id]: done },
      });
      expect(calls).toEqual([]);
      expect(result).toEqual({
        pullRequests: {},
        sections: {},
        sectionErrors: {},
        rateLimit: null,
      });
    });
  });
});
