// @vitest-environment node
/** The E2E mock speaks the operations of src/lib/github, fed by the shared fixture builders. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createGitHubClient } from '../../src/lib/github/client';
import { fetchPullRequestDetail } from '../../src/lib/github/fetchPullRequestDetail';
import { fetchPullRequests } from '../../src/lib/github/fetchPullRequests';
import { mapPullRequest } from '../../src/lib/github/mapPullRequest';
import { fetchViewerTeams } from '../../src/lib/github/teams';
import { MockGitHub } from '../e2e/mock-github/server';
import {
  checkRunNode,
  closedNode,
  detailNode,
  detailResponse,
  nodesResponse,
  prNode,
  searchResponse,
  teamJson,
  userTeamsPage,
} from '../fixtures/github';

const github = new MockGitHub();
beforeAll(() => github.start(0));
afterAll(() => github.stop());

it('serves ProwlSearch, ProwlNodes and, by default, ProwlMergeState over HTTP', async () => {
  const open = prNode({ number: 1, mergeStateStatus: 'CLEAN' });
  const merged = prNode({ number: 2 });
  github
    .onGraphQL('ProwlSearch', (variables) => searchResponse([open], variables))
    .onGraphQL('ProwlNodes', ({ ids }) => nodesResponse(ids, [closedNode(merged.id)]));
  const client = createGitHubClient({ token: 'e2e-token', apiUrl: github.origin });
  const settings = { repoInclude: [], repoExclude: [], maxPerSection: 50, unfollowedTeams: [] };

  const first = await fetchPullRequests(client, {
    ...settings,
    sections: [{ id: 'authored', kind: 'authored', label: 'Mine', enabled: true }],
  });
  const second = await fetchPullRequests(
    client,
    { ...settings, sections: [] },
    { pullRequests: { [merged.id]: mapPullRequest(merged) } },
  );

  expect(first.sections).toEqual({ authored: [open.id] });
  expect(first.pullRequests[open.id]?.mergeStateStatus).toBe('clean');
  expect(first.rateLimit?.remaining).toBe(4990);
  expect(second.pullRequests[merged.id]).toMatchObject({ state: 'merged', closedBy: 'octocat' });
  expect(github.requests.map((r) => r.operationName)).toEqual([
    'ProwlSearch',
    'ProwlMergeState',
    'ProwlNodes',
  ]);
  expect(github.requests[0]?.headers.authorization).toBe('Bearer e2e-token');
});

it('serves ProwlPullRequestDetail over HTTP, paged like GitHub', async () => {
  const checks = Array.from({ length: 130 }, (_, i) => checkRunNode(`job-${i}`));
  github.onGraphQL('ProwlPullRequestDetail', ({ after }) =>
    detailResponse(detailNode({ checks, after })),
  );
  const client = createGitHubClient({ token: 'e2e-token', apiUrl: github.origin });

  const detail = await fetchPullRequestDetail(client, 'PR_1');

  expect(detail.checks).toHaveLength(130);
  expect(detail.requiredApprovals).toBe(1);
  const sent = github
    .requestsFor('ProwlPullRequestDetail')
    .map((request) => (request.body as { variables: unknown }).variables);
  expect(sent).toEqual([
    { id: 'PR_1', after: null },
    { id: 'PR_1', after: '100' },
  ]);
});

it('lists no team by default, and the teams a test registers, paged like GitHub', async () => {
  const client = createGitHubClient({ token: 'e2e-token', apiUrl: github.origin });
  github.reset();
  expect(await fetchViewerTeams(client)).toEqual([]);

  const teams = Array.from({ length: 101 }, (_, i) => teamJson(`acme/t${100 + i}`, `T${i}`));
  github.on('GET', '/user/teams', ({ path }) => ({ body: userTeamsPage(teams, path) }));
  expect(await fetchViewerTeams(client)).toHaveLength(101);
  expect(github.requestsFor('/user/teams?per_page=100&page=2')).toHaveLength(1);
});
