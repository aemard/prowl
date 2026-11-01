import { describe, expect, it, vi } from 'vitest';
import {
  closedNode,
  type FullPullRequestNode,
  headCommit,
  mergeStateResponse,
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
import type { PullRequest, Section, Team, TeamsState } from '../model';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';
import { type FetchSettings, fetchPullRequests } from './fetchPullRequests';
import { mapPullRequest } from './mapPullRequest';
import type { PullRequestNode, SearchData } from './queries';
import { MAX_TEAM_SEARCHES } from './teams';

type Handler = (variables: Record<string, unknown>) => Response | Error | object;

/**
 * A client whose fetch answers each GraphQL operation with `handlers[name]`; `ProwlMergeState`
 * defaults to the facts of the PRs the searches returned.
 */
function setup(handlers: Record<string, Handler>) {
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const searched = new Map<string, FullPullRequestNode>();
  const fetch = vi.fn<FetchLike>(async (_url, init) => {
    const { query, variables } = JSON.parse(String(init.body));
    const operation = /query (\w+)/.exec(query)?.[1] ?? '';
    calls.push({ operation, variables });
    const handler =
      handlers[operation] ??
      (operation === 'ProwlMergeState'
        ? ({ ids }: Record<string, unknown>) => mergeStateResponse(ids, [...searched.values()])
        : undefined);
    const out = handler?.(variables) ?? new Error(`unexpected ${operation}`);
    if (out instanceof Error) throw out;
    if (operation === 'ProwlSearch' && 'search' in out) {
      for (const node of (out as SearchData).search.nodes ?? []) {
        if (node && 'id' in node) searched.set(node.id, node as FullPullRequestNode);
      }
    }
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
  unfollowedTeams: [],
  hideDrafts: false,
  hideBots: false,
  hideStaleAfterDays: 0,
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
        { 'author:@me': [a, b], 'user-review-requested:@me': [b, c] },
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
        first: 25,
        after: null,
      },
      {
        query: 'is:pr is:open user-review-requested:@me archived:false sort:updated-desc',
        first: 25,
        after: null,
      },
    ]);
    expect(result).toEqual({
      pullRequests: { [a.id]: mapped(a), [b.id]: mapped(b), [c.id]: mapped(c) },
      sections: { authored: [a.id, b.id], review_requested: [b.id, c.id] },
      sectionErrors: {},
      teamRequests: {},
      mergeStateAt: {
        [a.id]: expect.any(String),
        [b.id]: expect.any(String),
        [c.id]: expect.any(String),
      },
      rateLimit: { limit: 5000, remaining: 4990, resetAt: '2026-10-06T13:00:00.000Z' },
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
      [25, null],
      [25, '25'],
      [20, '50'],
    ]);
    expect(result.sections.authored).toHaveLength(70);

    const fewer = setup({ ProwlSearch: bySearch({ 'author:@me': nodes.slice(0, 20) }) });
    const small = await fetchPullRequests(fewer.client, settings({ maxPerSection: 100 }));
    expect(fewer.queries()).toHaveLength(1);
    expect(small.sections.authored).toHaveLength(20);
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
      ProwlMergeState: ({ ids }) => ({ ...mergeStateResponse(ids, pages), rateLimit: null }),
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
    // The section still lists what loaded, and says why the rest is missing.
    expect(result.sectionErrors.authored).toMatch(/^An organization requires single sign-on/);
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

  it('reports a preset search GitHub refused or gave up on, and loads the others', async () => {
    const pr = prNode({ number: 1 });
    const { client } = setup({
      ProwlSearch: ({ query }) =>
        String(query).includes('author:@me')
          ? jsonResponse({ message: 'Validation Failed' }, { status: 422 })
          : String(query).includes('mentions:@me')
            ? jsonResponse({ message: 'Bad gateway' }, { status: 502 })
            : searchResponse([pr]),
    });
    const result = await fetchPullRequests(
      client,
      settings({
        sections: [section('authored'), section('mentioned'), section('review_requested')],
      }),
    );
    expect(result.sections).toEqual({ review_requested: [pr.id] });
    expect(Object.keys(result.sectionErrors)).toEqual(['authored', 'mentioned']);
  });

  it('fails the poll when every search timed out: GitHub itself is failing', async () => {
    const { client } = setup({
      ProwlSearch: () => jsonResponse({ message: 'Bad gateway' }, { status: 502 }),
    });
    await expect(
      fetchPullRequests(
        client,
        settings({ sections: [section('authored'), section('mentioned')] }),
      ),
    ).rejects.toMatchObject({ kind: 'server' });
  });

  describe('merge facts', () => {
    const MINUTE = 60_000;
    const merge = (calls: { operation: string; variables: Record<string, unknown> }[]) =>
      calls.filter((c) => c.operation === 'ProwlMergeState').map((c) => c.variables.ids);

    it('reads them in batches of 10 for the PRs found', async () => {
      const nodes = Array.from({ length: 12 }, (_, i) =>
        prNode({ number: i + 1, mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED' }),
      );
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const result = await fetchPullRequests(client, settings());
      expect(merge(calls).map((ids) => (ids as string[]).length)).toEqual([10, 2]);
      expect(result.pullRequests[prId(12)]).toMatchObject({
        mergeStateStatus: 'clean',
        reviewDecision: 'approved',
      });
      expect(Object.keys(result.mergeStateAt)).toHaveLength(12);
    });

    it('publishes the list before merge reads and each completed batch, honoring new priorities', async () => {
      const nodes = Array.from({ length: 25 }, (_, i) => prNode({ number: i + 1 }));
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const progress: number[] = [];
      const pendingBatches: string[][] = [];
      let priority: string[] = [];
      await fetchPullRequests(
        client,
        settings(),
        null,
        null,
        undefined,
        async (result, pending) => {
          pendingBatches.push(pending);
          progress.push(Object.keys(result.mergeStateAt).length);
          expect(Object.keys(result.pullRequests)).toHaveLength(25);
          if (progress.length === 1) expect(merge(calls)).toEqual([]);
          if (progress.length === 1) priority = [prId(25)];
        },
        () => priority,
      );
      expect(progress).toEqual([0, 10, 20]);
      expect(pendingBatches.map((ids) => ids.length)).toEqual([10, 10, 0]);
      expect(pendingBatches[1]?.[0]).toBe(prId(25));
      expect(merge(calls).flat()[10]).toBe(prId(25));
    });

    it('bounds merge work and gives deferred PRs a turn on the next poll', async () => {
      const nodes = Array.from({ length: 35 }, (_, i) => prNode({ number: i + 1 }));
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const first = await fetchPullRequests(client, settings());
      expect(merge(calls).flat()).toHaveLength(20);
      expect(Object.keys(first.pullRequests)).toHaveLength(35);
      calls.length = 0;
      const next = await fetchPullRequests(client, settings(), first);
      expect(merge(calls).flat()).toEqual(nodes.slice(20).map(({ id }) => id));
      expect(Object.keys(next.mergeStateAt)).toHaveLength(35);
    });

    it('keeps the facts and date of a deferred PR, due until it is actually read', async () => {
      const nodes = Array.from({ length: 21 }, (_, i) => prNode({ number: i + 1 }));
      const previous = {
        pullRequests: Object.fromEntries(nodes.map((node) => [node.id, mapped(node)])),
        mergeStateAt: Object.fromEntries(
          nodes.map((node) => [node.id, new Date(Date.now() - 20 * MINUTE).toISOString()]),
        ),
      };
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const first = await fetchPullRequests(client, settings(), previous);
      expect(first.pullRequests[prId(21)]).toEqual(previous.pullRequests[prId(21)]);
      expect(first.mergeStateAt[prId(21)]).toBe(previous.mergeStateAt[prId(21)]);
      expect(first.mergeStateDue).toEqual([prId(21)]);
      calls.length = 0;
      const next = await fetchPullRequests(client, settings(), first);
      expect(merge(calls).flat()).toEqual([prId(21)]);
      expect(next.mergeStateDue).toBeUndefined();
    });

    it('drops the facts and the date of a PR whose search facts changed, read or not', async () => {
      const nodes = Array.from({ length: 21 }, (_, i) => prNode({ number: i + 1 }));
      const previous = {
        pullRequests: Object.fromEntries(
          nodes.map((node) => [node.id, { ...mapped(node), title: 'Old title' }]),
        ),
        mergeStateAt: Object.fromEntries(nodes.map((node) => [node.id, new Date().toISOString()])),
      };
      const { client } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const first = await fetchPullRequests(client, settings(), previous);
      expect(first.pullRequests[prId(21)]?.mergeStateStatus).toBe('unknown');
      expect(first.mergeStateAt[prId(21)]).toBeUndefined();
      expect(first.mergeStateDue).toEqual([prId(21)]);
    });

    it('prioritizes visible PRs and reuses hidden and snoozed facts for an hour', async () => {
      const nodes = Array.from({ length: 25 }, (_, i) =>
        prNode({ number: i + 1, isDraft: i < 10, mergeStateStatus: 'CLEAN' }),
      );
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const prefs = settings({ hideDrafts: true });
      const first = await fetchPullRequests(client, prefs);
      expect(merge(calls).flat().slice(0, 15)).toEqual(nodes.slice(10).map(({ id }) => id));
      const readAt = new Date(Date.now() - 30 * MINUTE).toISOString();
      const previous = {
        pullRequests: Object.fromEntries(nodes.map((node) => [node.id, mapped(node)])),
        mergeStateAt: Object.fromEntries(nodes.map((node) => [node.id, readAt])),
      };
      calls.length = 0;
      const local = {
        snoozed: { [prId(11)]: new Date(Date.now() + MINUTE).toISOString() },
        muted: {},
        seen: {},
      };
      const next = await fetchPullRequests(client, prefs, previous, null, local);
      expect(merge(calls).flat()).toEqual(nodes.slice(11).map(({ id }) => id));
      expect(next.mergeStateAt[prId(1)]).toBe(readAt);
      expect(next.mergeStateAt[prId(11)]).toBe(readAt);
      expect(Object.keys(first.pullRequests)).toHaveLength(25);
    });

    it('keeps them for an unchanged PR, and reads them again when it changed, is unknown or old', async () => {
      const now = Date.now();
      const node = (number: number) => prNode({ number, mergeStateStatus: 'CLEAN' });
      const [one, two, three, four] = [node(1), node(2), node(3), node(4)];
      const nodes = [one, two, three, four];
      const behind = (node: PullRequestNode) => ({
        ...mapped(node),
        mergeStateStatus: 'behind' as const,
      });
      const reordered = JSON.parse(JSON.stringify(behind(one)), (_key: string, value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      );
      const previous = {
        pullRequests: {
          // Chrome serializes stored object keys in a different order, including nested maps.
          [prId(1)]: reordered,
          [prId(2)]: { ...behind(two), title: 'Renamed since' },
          [prId(3)]: { ...behind(three), mergeable: 'unknown' as const },
          [prId(4)]: behind(four),
        },
        mergeStateAt: {
          [prId(1)]: new Date(now - 5 * MINUTE).toISOString(),
          [prId(2)]: new Date(now - 5 * MINUTE).toISOString(),
          [prId(3)]: new Date(now - 5 * MINUTE).toISOString(),
          [prId(4)]: new Date(now - 15 * MINUTE).toISOString(),
        },
      };
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const result = await fetchPullRequests(client, settings(), previous);
      expect(merge(calls)).toEqual([[prId(4), prId(2), prId(3)]]);
      expect(result.pullRequests[prId(1)]?.mergeStateStatus).toBe('behind');
      expect(result.mergeStateAt[prId(1)]).toBe(previous.mergeStateAt[prId(1)]);
      expect(result.pullRequests[prId(4)]?.mergeStateStatus).toBe('clean');
    });

    it('keeps the previous facts of a batch GitHub gave up on, and reads them next time', async () => {
      const node = prNode({ number: 1, mergeStateStatus: 'CLEAN' });
      const previous = {
        pullRequests: {
          [node.id]: { ...mapped(node), mergeStateStatus: 'behind' as const },
        },
      };
      const { client } = setup({
        ProwlSearch: bySearch({ 'author:@me': [node] }),
        ProwlMergeState: () => jsonResponse({ message: 'Bad gateway' }, { status: 504 }),
      });
      const result = await fetchPullRequests(client, settings(), previous);
      expect(result.pullRequests[node.id]?.mergeStateStatus).toBe('behind');
      expect(result.mergeStateAt).toEqual({});
    });

    it('reads nothing from the nodes of a partial response, and says the section is incomplete', async () => {
      const [read, hole] = [prNode({ number: 1 }), prNode({ number: 2 })];
      const previous = {
        pullRequests: { [hole.id]: { ...mapped(hole), mergeStateStatus: 'behind' as const } },
      };
      const { client } = setup({
        ProwlSearch: bySearch({ 'author:@me': [read, hole] }),
        ProwlMergeState: ({ ids }) =>
          jsonResponse({
            // A null `reviewDecision` here is an error, not "no review required".
            data: mergeStateResponse(ids, [{ ...read, reviewDecision: null }]),
            errors: [
              graphqlError('FORBIDDEN', 'Cannot read reviews', ['nodes', 0, 'reviewDecision']),
              graphqlError('NOT_FOUND', 'Could not resolve to a node', ['nodes', 1]),
            ],
          }),
      });
      const result = await fetchPullRequests(client, settings(), previous);
      expect(result.pullRequests[read.id]).toMatchObject({
        reviewDecision: 'unknown',
        mergeStateStatus: 'unknown',
      });
      // The hole keeps what it had.
      expect(result.pullRequests[hole.id]?.mergeStateStatus).toBe('behind');
      expect(result.mergeStateAt).toEqual({});
      expect(result.sectionErrors.authored).toContain('Some merge requirements could not be read');
      expect(result.sectionErrors.authored).toContain('nodes.0.reviewDecision');
      expect(result.sectionCoverage?.authored?.partial).toBe(true);
    });

    it('fails the poll on a rejected token', async () => {
      const { client } = setup({
        ProwlSearch: bySearch({ 'author:@me': [prNode()] }),
        ProwlMergeState: () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
      });
      await expect(fetchPullRequests(client, settings())).rejects.toMatchObject({
        kind: 'unauthorized',
      });
    });
  });

  it('does not reuse old head facts for PRs outside the merge budget', async () => {
    const old = Array.from({ length: 21 }, (_, i) =>
      prNode({ number: i + 1, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
    );
    const fresh = old.map((pr) => ({ ...pr, headRefOid: 'b'.repeat(40) }));
    const { client } = setup({ ProwlSearch: bySearch({ 'author:@me': fresh }) });
    const result = await fetchPullRequests(client, settings(), {
      pullRequests: Object.fromEntries(old.map((pr) => [pr.id, mapped(pr)])),
    });
    expect(result.pullRequests[prId(21)]).toMatchObject({
      mergeStateStatus: 'unknown',
      reviewDecision: 'unknown',
      viewerCanUpdate: false,
    });
    expect(result.mergeStateAt[prId(21)]).toBeUndefined();
  });

  it('rejects a merge response computed for a different head during the poll', async () => {
    const node = prNode();
    const { client } = setup({
      ProwlSearch: bySearch({ 'author:@me': [node] }),
      ProwlMergeState: () =>
        mergeStateResponse(
          [node.id],
          [{ ...node, headRefOid: 'b'.repeat(40), mergeStateStatus: 'CLEAN' }],
        ),
    });
    const result = await fetchPullRequests(client, settings());
    expect(result.pullRequests[node.id]?.mergeStateStatus).toBe('unknown');
    expect(result.mergeStateAt[node.id]).toBeUndefined();
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

      expect(calls.find(({ operation }) => operation === 'ProwlNodes')).toEqual({
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
      expect(result.rateLimit?.remaining).toBe(4990);
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
      // A deleted PR is no reason to warn about the section.
      expect(result.sectionErrors).toEqual({});
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
        teamRequests: {},
        mergeStateAt: {},
        rateLimit: null,
      });
    });
  });

  describe('team reviews', () => {
    const teamSection = section('team_review_requested');
    const team = (key: string): Team => {
      const [org = '', slug = ''] = key.split('/');
      return { org, slug, name: slug };
    };
    const discovered = (...keys: string[]) => ({ teams: keys.map(team), error: null });
    const at = (number: number, updatedAt: string) => prNode({ number, updatedAt });

    it('searches each followed team and merges the results newest first, capped', async () => {
      const [old, mid, recent, newest] = [
        at(1, '2026-10-01T00:00:00Z'),
        at(2, '2026-10-02T00:00:00Z'),
        at(3, '2026-10-03T00:00:00Z'),
        at(4, '2026-10-04T00:00:00Z'),
      ];
      const { client, queries } = setup({
        ProwlSearch: bySearch({
          'team-review-requested:acme/core ': [recent, old],
          'team-review-requested:acme/web ': [newest, recent, mid],
        }),
      });
      const result = await fetchPullRequests(
        client,
        settings({
          sections: [teamSection],
          maxPerSection: 3,
          repoExclude: ['acme/old'],
          unfollowedTeams: ['acme/docs'],
        }),
        null,
        discovered('Acme/Core', 'acme/docs', 'acme/web'),
      );

      expect(queries().map(({ query }) => query)).toEqual([
        'is:pr is:open team-review-requested:acme/core archived:false -repo:acme/old sort:updated-desc',
        'is:pr is:open team-review-requested:acme/web archived:false -repo:acme/old sort:updated-desc',
      ]);
      expect(result.sections).toEqual({
        team_review_requested: [newest.id, recent.id, mid.id],
      });
      expect(Object.keys(result.pullRequests)).toEqual([newest.id, recent.id, mid.id]);
      expect(result.teamRequests).toEqual({
        [newest.id]: ['acme/web'],
        [recent.id]: ['acme/core', 'acme/web'],
        [mid.id]: ['acme/web'],
      });
      expect(result.sectionErrors).toEqual({});
    });

    const missingScope: Pick<TeamsState, 'teams' | 'error'> = {
      teams: [],
      error: { kind: 'missing_scope', message: 'Needs read:org.' },
    };
    it.each([
      ['no team list', null, /GitHub lists no team for your account/],
      ['no team', discovered(), /GitHub lists no team for your account/],
      ['a failed discovery', missingScope, /^Needs read:org\.$/],
    ])('reports %s without searching', async (_, teams, message) => {
      const { client, calls } = setup({});
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        teams,
      );
      expect(calls).toEqual([]);
      expect(result.sectionErrors.team_review_requested).toMatch(message);
      expect(result.sections).toEqual({});
    });

    it('asks to follow a team when every team is unfollowed', async () => {
      const { client, calls } = setup({});
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection], unfollowedTeams: ['acme/core'] }),
        null,
        { teams: [team('acme/core')], error: { kind: 'server', message: 'Down.' } },
      );
      expect(calls).toEqual([]);
      expect(result.sectionErrors).toEqual({
        team_review_requested: 'You follow none of your teams. Follow one in Settings.',
      });
    });

    it('searches a stale list when the last discovery failed', async () => {
      const pr = prNode();
      const { client } = setup({ ProwlSearch: bySearch({ 'acme/core': [pr] }) });
      const result = await fetchPullRequests(client, settings({ sections: [teamSection] }), null, {
        teams: [team('acme/core')],
        error: { kind: 'server', message: 'Down.' },
      });
      expect(result.sections).toEqual({ team_review_requested: [pr.id] });
      expect(result.sectionErrors).toEqual({});
    });

    it('reports a refused team search and keeps the teams that loaded', async () => {
      const pr = prNode();
      const { client } = setup({
        ProwlSearch: (variables) =>
          String(variables.query).includes('acme/gone')
            ? jsonResponse({ message: 'Validation Failed' }, { status: 422 })
            : searchResponse([pr], variables),
      });
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        discovered('acme/core', 'acme/gone'),
      );
      expect(result.sections).toEqual({ team_review_requested: [pr.id] });
      expect(result.teamRequests).toEqual({ [pr.id]: ['acme/core'] });
      expect(result.sectionErrors).toEqual({
        team_review_requested: 'GitHub refused the search for acme/gone: Validation Failed',
      });
    });

    it("says when an organization's SAML enforcement left holes in a team search", async () => {
      const pr = prNode();
      const { client } = setup({
        ProwlSearch: (variables) =>
          jsonResponse({
            data: searchResponse([pr], variables),
            ...(String(variables.query).includes('acme/sso')
              ? {
                  errors: [
                    graphqlError(
                      'FORBIDDEN',
                      'Resource protected by organization SAML enforcement.',
                    ),
                  ],
                }
              : {}),
          }),
      });
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        discovered('acme/core', 'acme/sso'),
      );
      expect(result.sections).toEqual({ team_review_requested: [pr.id] });
      expect(result.sectionErrors.team_review_requested).toMatch(
        /^An organization requires single sign-on \(SAML\)/,
      );
    });

    it('throws what fails the whole poll', async () => {
      const { client } = setup({
        ProwlSearch: () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
      });
      await expect(
        fetchPullRequests(client, settings({ sections: [teamSection] }), null, discovered('a/b')),
      ).rejects.toMatchObject({ kind: 'unauthorized' });
    });

    it(`searches the first ${MAX_TEAM_SEARCHES} followed teams and says how many it skipped`, async () => {
      const keys = Array.from({ length: MAX_TEAM_SEARCHES + 2 }, (_, i) => `acme/t${i + 10}`);
      const { client, queries } = setup({ ProwlSearch: bySearch({}) });
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        discovered(...keys),
      );
      expect(queries()).toHaveLength(MAX_TEAM_SEARCHES);
      expect(result.sections).toEqual({ team_review_requested: [] });
      expect(result.sectionErrors.team_review_requested).toBe(
        `Partial results: ${MAX_TEAM_SEARCHES} of 12 followed teams searched. Choose teams in Settings.`,
      );
    });
  });
});

describe('bounded and partial section coverage', () => {
  it.each([49, 50, 51])('reports extra results only when GitHub has more (%s)', async (count) => {
    const nodes = Array.from({ length: count }, (_, i) => prNode({ number: i + 1 }));
    const { client } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
    const result = await fetchPullRequests(client, settings());
    expect(result.sections.authored?.length).toBe(Math.min(count, 50));
    expect(result.sectionCoverage?.authored?.hasMore ?? false).toBe(count > 50);
    if (count > 50)
      expect(result.sectionCoverage?.authored?.queries[0]).toMatchObject({
        cursor: '50',
        total: 51,
      });
  });

  it('looks beyond rejected repository pages, under a separate scan budget', async () => {
    const nodes = Array.from({ length: 51 }, (_, i) =>
      prNode({ number: i + 1, repository: i === 50 ? 'allowed/repo' : 'elsewhere/repo' }),
    );
    const { client, queries } = setup({
      ProwlSearch: (variables) => searchResponse(nodes, variables),
    });
    const result = await fetchPullRequests(
      client,
      settings({
        sections: [section('custom', { query: 'org:elsewhere org:allowed is:open' })],
        repoInclude: ['allowed/repo'],
      }),
    );
    expect(result.sections.custom).toEqual([prId(51, 'allowed/repo')]);
    expect(queries().length).toBe(3);
  });

  it('keeps fetched pages and previous section members when a subsequent page fails', async () => {
    const nodes = Array.from({ length: 26 }, (_, i) => prNode({ number: i + 1 }));
    const old = prNode({ number: 99 });
    const { client } = setup({
      ProwlSearch: (variables) =>
        variables.after
          ? jsonResponse({ message: 'Bad gateway' }, { status: 502 })
          : searchResponse(nodes, variables),
    });
    const result = await fetchPullRequests(client, settings(), {
      pullRequests: { [old.id]: mapped(old) },
      sections: { authored: [old.id] },
    });
    expect(result.sections.authored).toHaveLength(26);
    expect(result.sections.authored).toContain(old.id);
    expect(result.sectionCoverage?.authored).toMatchObject({
      partial: true,
      stale: true,
      hasMore: true,
    });
    expect(result.sectionErrors.authored).toContain('Bad gateway');
  });

  it('reports non-SAML node errors and their field path rather than a complete empty result', async () => {
    const data = searchResponse([null]);
    const { client } = setup({
      ProwlSearch: () =>
        jsonResponse({
          data,
          errors: [
            graphqlError('FORBIDDEN', 'Resource not accessible by personal access token', [
              'search',
              'nodes',
              0,
            ]),
          ],
        }),
    });
    const result = await fetchPullRequests(client, settings());
    expect(result.sectionCoverage?.authored?.partial).toBe(true);
    expect(result.sectionErrors.authored).toContain('Resource not accessible');
    expect(result.sectionErrors.authored).toContain('search.nodes.0');
  });

  it('does not let a failed section overwrite the fresh copy another section loaded', async () => {
    const [old, fresh] = [prNode({ title: 'Old' }), prNode({ title: 'Fresh' })];
    const { client } = setup({
      ProwlSearch: (variables) =>
        String(variables.query).includes('mentions:')
          ? jsonResponse({ message: 'Bad gateway' }, { status: 502 })
          : searchResponse([fresh], variables),
    });
    const result = await fetchPullRequests(
      client,
      settings({ sections: [section('authored'), section('mentioned')] }),
      { pullRequests: { [old.id]: mapped(old) }, sections: { mentioned: [old.id] } },
    );
    expect(result.sections).toEqual({ authored: [fresh.id], mentioned: [fresh.id] });
    expect(result.pullRequests[fresh.id]?.title).toBe('Fresh');
  });

  it('does not keep PRs that left a search which only had unreadable nodes', async () => {
    const [kept, gone] = [prNode({ number: 1 }), prNode({ number: 2 })];
    const { client } = setup({
      ProwlSearch: (variables) =>
        jsonResponse({
          data: searchResponse([null, kept], variables),
          errors: [graphqlError('FORBIDDEN', 'SAML enforcement', ['search', 'nodes', 0])],
        }),
      ProwlNodes: ({ ids }) => nodesResponse(ids, [closedNode(gone.id, { state: 'CLOSED' })]),
    });
    const result = await fetchPullRequests(client, settings(), {
      pullRequests: { [gone.id]: mapped(gone) },
      sections: { authored: [gone.id] },
    });
    expect(result.sections.authored).toEqual([kept.id]);
    expect(result.pullRequests[gone.id]?.state).toBe('closed');
    expect(result.sectionCoverage?.authored).toMatchObject({ partial: true });
    expect(result.sectionCoverage?.authored?.stale).toBeUndefined();
  });

  it('stops at a cursor that does not advance and keeps the cached members, closed ones too', async () => {
    const loaded = prNode({ number: 1 });
    const cached: PullRequest = { ...mapped(prNode({ number: 2 })), state: 'merged' };
    const { client } = setup({
      ProwlSearch: () => ({
        search: {
          issueCount: 99,
          pageInfo: { hasNextPage: true, endCursor: null },
          nodes: [loaded],
        },
        rateLimit: graphqlRateLimit(),
      }),
    });
    const result = await fetchPullRequests(
      client,
      settings({ sections: [section('custom', { query: 'is:merged' })] }),
      { pullRequests: { [cached.id]: cached }, sections: { custom: [cached.id] } },
    );
    expect(result.sections.custom).toEqual([loaded.id, cached.id]);
    expect(result.sectionErrors.custom).toBe('GitHub did not provide a usable next-page cursor.');
    expect(result.sectionCoverage?.custom).toMatchObject({
      hasMore: true,
      partial: true,
      stale: true,
    });
  });

  it('publishes a completed section before the next search starts, keeping the pending one cached', async () => {
    const [mine, cached] = [prNode({ number: 1 }), prNode({ number: 2 })];
    const publications: unknown[] = [];
    const { client } = setup({
      ProwlSearch: (variables) => {
        if (String(variables.query).includes('mentions:')) {
          expect(publications).toEqual([
            {
              sections: { authored: [mine.id], mentioned: [cached.id] },
              pending: ['mentioned'],
              cards: [mine.id, cached.id],
            },
          ]);
          return searchResponse([], variables);
        }
        return searchResponse([mine], variables);
      },
      ProwlNodes: ({ ids }) => nodesResponse(ids, [closedNode(cached.id, { state: 'OPEN' })]),
    });
    const result = await fetchPullRequests(
      client,
      settings({ sections: [section('authored'), section('mentioned')] }),
      { pullRequests: { [cached.id]: mapped(cached) }, sections: { mentioned: [cached.id] } },
      null,
      undefined,
      async ({ sections, sectionsPending, pullRequests }) => {
        publications.push({
          sections: { ...sections },
          pending: sectionsPending && [...sectionsPending],
          cards: Object.keys(pullRequests),
        });
      },
    );
    expect(result.sections).toEqual({ authored: [mine.id], mentioned: [] });
    expect(result.sectionsPending).toBeUndefined();
  });
});

it('reserves merge reads for old hidden PRs despite continuous visible priority hints', async () => {
  const now = Date.now();
  const nodes = Array.from({ length: 25 }, (_, index) =>
    prNode({ number: index + 1, isDraft: index >= 20 }),
  );
  const previous = {
    pullRequests: Object.fromEntries(nodes.map((node) => [node.id, mapped(node)])),
    mergeStateAt: Object.fromEntries(
      nodes.map((node, index) => [
        node.id,
        new Date(now - (index >= 20 ? 120 : 20) * 60_000).toISOString(),
      ]),
    ),
  };
  const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
  const result = await fetchPullRequests(
    client,
    settings({ hideDrafts: true }),
    previous,
    null,
    undefined,
    undefined,
    () => nodes.slice(0, 20).map(({ id }) => id),
  );
  const reads = calls
    .filter(({ operation }) => operation === 'ProwlMergeState')
    .flatMap(({ variables }) => variables.ids);
  expect(reads).toHaveLength(20);
  expect(reads).toContain(prId(21));
  expect(reads).toContain(prId(22));
  expect(result.mergeStateAt[prId(19)]).toBe(previous.mergeStateAt[prId(19)]);
  expect(result.mergeStateDue).toContain(prId(19));
});

it('bounds page requests independently of a tiny retained limit and rejected repositories', async () => {
  const nodes = Array.from({ length: 101 }, (_, index) =>
    prNode({ number: index + 1, repository: 'excluded/repo' }),
  );
  const { client, queries } = setup({
    ProwlSearch: (variables) => searchResponse(nodes, variables),
  });
  const result = await fetchPullRequests(
    client,
    settings({
      maxPerSection: 1,
      repoInclude: ['allowed/repo'],
      sections: [section('custom', { query: 'org:excluded' })],
    }),
  );
  expect(queries()).toHaveLength(20);
  expect(result.sections.custom).toEqual([]);
  expect(result.sectionCoverage?.custom?.hasMore).toBe(true);
});

it('invalidates cached readiness on changed same-head evidence, even when enrichment fails', async () => {
  const old = prNode({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' });
  const changed = { ...old, commits: headCommit({ FAILURE: 1 }) };
  const { client } = setup({
    ProwlSearch: bySearch({ 'author:@me': [changed] }),
    ProwlMergeState: () => jsonResponse({ message: 'Bad gateway' }, { status: 502 }),
  });
  const published: Array<PullRequest | undefined> = [];
  const result = await fetchPullRequests(
    client,
    settings(),
    {
      pullRequests: { [old.id]: mapped(old) },
      mergeStateAt: { [old.id]: new Date().toISOString() },
    },
    null,
    undefined,
    async (snapshot) => {
      published.push(snapshot.pullRequests[old.id]);
    },
  );
  for (const pr of [...published, result.pullRequests[old.id]]) {
    expect(pr?.mergeStateStatus).toBe('unknown');
    expect(pr?.reviewDecision).toBe('unknown');
  }
  expect(result.mergeStateDue).toContain(old.id);
  expect(result.mergeStateAt[old.id]).toBeUndefined();
});

it('never lets an errored section fallback overwrite a newer PR from another section', async () => {
  const old = prNode();
  const fresh = prNode({ headRefOid: 'b'.repeat(40) });
  const { client } = setup({
    ProwlSearch: (variables) =>
      String(variables.query).includes('user-review-requested')
        ? jsonResponse({ message: 'Bad gateway' }, { status: 502 })
        : searchResponse([fresh], variables),
  });
  const result = await fetchPullRequests(
    client,
    settings({ sections: [section('authored'), section('review_requested')] }),
    {
      pullRequests: { [old.id]: mapped(old) },
      sections: { authored: [old.id], review_requested: [old.id] },
    },
  );
  expect(result.sections.review_requested).toContain(old.id);
  expect(result.pullRequests[old.id]?.headSha).toBe(fresh.headRefOid);
});
