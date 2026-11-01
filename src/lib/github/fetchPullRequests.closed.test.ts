import { expect, it } from 'vitest';
import { closedNode, nodesResponse, prNode } from '../../../tests/fixtures/github';
import { graphqlError, graphqlRateLimit, jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../model';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, settings, setup } from './fetchPullRequests.test-support';

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

it('fetchPullRequests PRs that left every section looks up open ones by id and keeps the merged and closed ones', async () => {
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

it('fetchPullRequests PRs that left every section tolerates deleted PRs reported as partial errors', async () => {
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

it('fetchPullRequests PRs that left every section asks for at most 100 ids per query', async () => {
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

it('fetchPullRequests PRs that left every section sends nothing when no section is enabled and nothing left', async () => {
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
