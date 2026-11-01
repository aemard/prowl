import { describe, expect, it } from 'vitest';
import {
  closedNode,
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
import type { PullRequest } from '../model';
import { GitHubError } from './errors';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, section, settings, setup } from './fetchPullRequests.test-support';
import type { PullRequestNode } from './queries';

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

    it('keeps changed deferred facts due until they are actually read', async () => {
      const nodes = Array.from({ length: 21 }, (_, i) => prNode({ number: i + 1 }));
      const previous = {
        pullRequests: Object.fromEntries(
          nodes.map((node) => [node.id, { ...mapped(node), title: 'Old title' }]),
        ),
        mergeStateAt: Object.fromEntries(nodes.map((node) => [node.id, new Date().toISOString()])),
      };
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const first = await fetchPullRequests(client, settings(), previous);
      expect(first.pullRequests[prId(21)]?.mergeStateStatus).toBe(
        previous.pullRequests[prId(21)]?.mergeStateStatus,
      );
      expect(first.mergeStateAt[prId(21)]).toBeUndefined();
      calls.length = 0;
      await fetchPullRequests(client, settings(), first);
      expect(merge(calls).flat()).toEqual([prId(21)]);
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
      const previous = {
        pullRequests: {
          [prId(1)]: behind(one),
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
          [node.id]: { ...mapped(node), title: 'Old', mergeStateStatus: 'behind' as const },
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
});
