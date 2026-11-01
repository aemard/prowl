import { expect, it } from 'vitest';
import { mergeStateResponse, prId, prNode, searchResponse } from '../../../tests/fixtures/github';
import {
  graphqlError,
  graphqlRateLimit,
  jsonResponse,
  rateLimitHeaders,
} from '../../../tests/fixtures/http';
import { GitHubError } from './errors';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, section, settings, setup } from './fetchPullRequests.test-support';

it('fetchPullRequests searches each enabled section, most recently updated first, and dedupes PRs', async () => {
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

it('fetchPullRequests keeps the sort of a custom query and sends the repo filters', async () => {
  const { client, queries } = setup({ ProwlSearch: bySearch({}) });
  const custom = section('custom', { id: 'custom-1', query: 'label:bug sort:created-asc' });
  await fetchPullRequests(
    client,
    settings({ sections: [custom], repoInclude: ['acme'], repoExclude: ['acme/old'] }),
  );
  expect(queries()[0]?.query).toBe('is:pr label:bug sort:created-asc user:acme -repo:acme/old');
});

it('fetchPullRequests pages with the cursor up to maxPerSection', async () => {
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

it('fetchPullRequests dedupes a PR that moved between two pages', async () => {
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

it('fetchPullRequests applies the repo filters client-side', async () => {
  const kept = prNode({ number: 1, repository: 'acme/api' });
  const dropped = prNode({ number: 2, repository: 'acme/legacy' });
  const { client } = setup({ ProwlSearch: bySearch({ 'author:@me': [kept, dropped] }) });
  const result = await fetchPullRequests(client, settings({ repoExclude: ['acme/legacy'] }));
  expect(Object.keys(result.pullRequests)).toEqual([kept.id]);
  expect(result.sections.authored).toEqual([kept.id]);
});

it('fetchPullRequests skips holes left by partial errors and non-PR results', async () => {
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

it('fetchPullRequests reports an invalid custom query without sending it', async () => {
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
  'fetchPullRequests reports a custom section that GitHub refuses with %s and loads the others',
  async (_, refusal, message) => {
    const pr = prNode();
    const { client } = setup({
      ProwlSearch: (variables) =>
        String(variables.query).includes('label:bug') ? refusal() : searchResponse([pr], variables),
    });
    const result = await fetchPullRequests(
      client,
      settings({
        sections: [section('custom', { id: 'custom-1', query: 'label:bug' }), section('authored')],
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
] as const)('fetchPullRequests throws %s even for a custom section', async (kind, failure) => {
  const { client } = setup({ ProwlSearch: failure });
  const custom = section('custom', { id: 'custom-1', query: 'label:bug' });
  const error = await fetchPullRequests(client, settings({ sections: [custom] })).catch(
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(GitHubError);
  expect((error as GitHubError).kind).toBe(kind);
});

it('fetchPullRequests reports a preset search GitHub refused or gave up on, and loads the others', async () => {
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

it('fetchPullRequests fails the poll when every search timed out: GitHub itself is failing', async () => {
  const { client } = setup({
    ProwlSearch: () => jsonResponse({ message: 'Bad gateway' }, { status: 502 }),
  });
  await expect(
    fetchPullRequests(client, settings({ sections: [section('authored'), section('mentioned')] })),
  ).rejects.toMatchObject({ kind: 'server' });
});
