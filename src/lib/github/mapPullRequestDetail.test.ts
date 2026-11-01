import { expect, it } from 'vitest';
import {
  checkRunNode,
  closedNode,
  detailNode,
  detailReview,
  prNode,
  requestedReviewer,
  statusContextNode,
} from '../../../tests/fixtures/github';
import { mapClosedState, mapPullRequest, mapPullRequestDetail } from './mapPullRequest';

const open = mapPullRequest(prNode());

it('mapClosedState marks a merged PR with whoever merged it', () => {
  expect(mapClosedState(open, closedNode(open.id, { by: 'hubot' }))).toEqual({
    ...open,
    state: 'merged',
    updatedAt: '2026-10-06T08:00:00Z',
    closedBy: 'hubot',
  });
});

it('mapClosedState marks a closed PR with the actor of the latest ClosedEvent', () => {
  const closed = mapClosedState(open, closedNode(open.id, { state: 'CLOSED', by: 'monalisa' }));
  expect(closed).toMatchObject({ state: 'closed', closedBy: 'monalisa' });
  const node = closedNode(open.id, { state: 'CLOSED', by: null });
  expect(mapClosedState(open, node)?.closedBy).toBeNull();
  expect(mapClosedState(open, { ...node, timelineItems: { nodes: null } })?.closedBy).toBeNull();
});

it('mapClosedState trusts merged over an unknown state', () => {
  const node = { ...closedNode(open.id), state: 'SOMETHING_NEW' };
  expect(mapClosedState(open, node)?.state).toBe('merged');
});

it('mapClosedState returns null while the PR is still open', () => {
  expect(mapClosedState(open, closedNode(open.id, { state: 'OPEN' }))).toBeNull();
  expect(mapClosedState(open, { ...closedNode(open.id), merged: false, state: 'NEW' })).toBeNull();
});

const AVATAR = 'https://avatars.githubusercontent.com/u/583231?s=64&v=4';

it('mapPullRequestDetail lists failed checks first, then pending, passed and neutral, each with its link', () => {
  const detail = mapPullRequestDetail([
    detailNode({
      checks: [
        checkRunNode('lint', 'SUCCESS'),
        checkRunNode('docs', 'SKIPPED'),
        checkRunNode('build', 'FAILURE', { isRequired: true }),
        checkRunNode('e2e', 'IN_PROGRESS'),
        statusContextNode('ci/circle', 'PENDING'),
        statusContextNode('ci/jenkins', 'ERROR', { targetUrl: 'https://jenkins.example/job/1' }),
        checkRunNode('deploy', 'TIMED_OUT'),
      ],
    }),
  ]);
  expect(detail.checks.map(({ name, state }) => `${state}:${name}`)).toEqual([
    'failed:build',
    'failed:ci/jenkins',
    'failed:deploy',
    'pending:e2e',
    'pending:ci/circle',
    'passed:lint',
    'neutral:docs',
  ]);
  expect(detail.checks[0]).toEqual({
    name: 'build',
    state: 'failed',
    url: 'https://github.com/acme/widgets/actions/runs/1/job/build',
    required: true,
  });
  expect(detail.checks[1]?.required).toBe(false);
  expect(detail.checksTotal).toBe(7);
});

it('mapPullRequestDetail reads the state of a run from its conclusion once completed, else from its status', () => {
  const states = (...runs: ReturnType<typeof checkRunNode>[]) =>
    mapPullRequestDetail([detailNode({ checks: runs })]).checks.map((c) => c.state);
  expect(states(checkRunNode('a', 'CANCELLED'), checkRunNode('b', 'ACTION_REQUIRED'))).toEqual([
    'failed',
    'neutral',
  ]);
  expect(states(checkRunNode('a', 'QUEUED'), checkRunNode('b', 'WAITING'))).toEqual([
    'pending',
    'pending',
  ]);
  // COMPLETED without a conclusion, and a state GitHub adds later, are neutral.
  expect(
    states(checkRunNode('a', 'SUCCESS', { conclusion: null }), checkRunNode('b', 'BRAND_NEW')),
  ).toEqual(['neutral', 'neutral']);
});

it('mapPullRequestDetail keeps only http(s) links and skips holes and unknown contexts', () => {
  const detail = mapPullRequestDetail([
    detailNode({
      checks: [
        null,
        checkRunNode('a', 'SUCCESS', { detailsUrl: null }),
        checkRunNode('b', 'SUCCESS', { detailsUrl: 'javascript:alert(1)' }),
        statusContextNode('c', 'SUCCESS', { targetUrl: 'HTTPS://ci.example/c' }),
      ],
    }),
  ]);
  expect(detail.checks.map((c) => c.url)).toEqual([null, null, 'HTTPS://ci.example/c']);
});

it('mapPullRequestDetail merges the checks of every page and reports the total of the first', () => {
  const all = Array.from({ length: 5 }, (_, i) => checkRunNode(`job-${i}`));
  const detail = mapPullRequestDetail([
    detailNode({ checks: all, pageSize: 3 }),
    detailNode({ checks: all, pageSize: 3, after: '3' }),
  ]);
  expect(detail.checks).toHaveLength(5);
  expect(detail.checksTotal).toBe(5);
});

it('mapPullRequestDetail has no checks without a rollup, or when a read failed as a whole', () => {
  const none = { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } };
  expect(mapPullRequestDetail([detailNode(none)])).toMatchObject({ checks: [], checksTotal: 0 });
  const noNodes = detailNode();
  const [only] = noNodes.commits.nodes ?? [];
  if (only?.commit.statusCheckRollup) only.commit.statusCheckRollup.contexts.nodes = null;
  expect(mapPullRequestDetail([noNodes]).checks).toEqual([]);
  expect(mapPullRequestDetail([detailNode({ commits: { nodes: null } })]).checks).toEqual([]);
});

it('mapPullRequestDetail lists reviewers with their state, blocking ones first, and who is still asked', () => {
  const detail = mapPullRequestDetail([
    detailNode({
      latestReviews: {
        nodes: [
          detailReview('alice', 'APPROVED'),
          detailReview('bob', 'CHANGES_REQUESTED'),
          detailReview('carol', 'COMMENTED'),
          detailReview('dave', 'DISMISSED'),
          detailReview('erin', 'PENDING'),
          detailReview(null, 'APPROVED'),
          null,
        ],
      },
      reviewRequests: {
        nodes: [
          requestedReviewer('frank'),
          requestedReviewer('alice'),
          requestedReviewer(null),
          { requestedReviewer: null },
          { requestedReviewer: { login: 'hubot' } },
        ],
      },
    }),
  ]);
  expect(detail.reviewers.map(({ login, state }) => `${login}:${state}`)).toEqual([
    'bob:changes_requested',
    'frank:requested',
    'hubot:requested',
    'alice:approved',
    'ghost:approved',
    'carol:commented',
    'dave:dismissed',
  ]);
  expect(detail.reviewers[0]?.avatarUrl).toBe(AVATAR);
  expect(detail.reviewers.find((r) => r.login === 'ghost')?.avatarUrl).toBe('');
  expect(detail.reviewers.find((r) => r.login === 'hubot')?.avatarUrl).toBe('');
});

it('mapPullRequestDetail reads the base branch rules, and none when they are missing or not visible', () => {
  const rules = (branchProtectionRule: unknown) =>
    mapPullRequestDetail([detailNode({ baseRef: { branchProtectionRule } as never })]);
  expect(
    rules({ requiredApprovingReviewCount: 2, requiresConversationResolution: true }),
  ).toMatchObject({ requiredApprovals: 2, requiresConversationResolution: true });
  expect(
    rules({ requiredApprovingReviewCount: 0, requiresConversationResolution: false }),
  ).toMatchObject({ requiredApprovals: null, requiresConversationResolution: false });
  expect(rules(null)).toMatchObject({
    requiredApprovals: null,
    requiresConversationResolution: false,
  });
  expect(mapPullRequestDetail([detailNode({ baseRef: null })]).requiredApprovals).toBeNull();
});

it('mapPullRequestDetail has no reviewers when GitHub returns none', () => {
  const detail = mapPullRequestDetail([detailNode({ latestReviews: null, reviewRequests: null })]);
  expect(detail.reviewers).toEqual([]);
});
