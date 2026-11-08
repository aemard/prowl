import {
  checkRunNode,
  closedNode,
  detailNode,
  detailResponse,
  headCommit,
  mergeStateResponse,
  nodesResponse,
  prNode,
  searchResponse,
} from '../../tests/fixtures/github';

const now = new Date().toISOString();
const nodes = [
  prNode({
    number: 101,
    title: 'Add keyboard shortcuts',
    repository: 'acme/web',
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
  }),
  prNode({
    number: 102,
    title: 'Fix checkout validation',
    repository: 'acme/web',
    commits: headCommit({ FAILURE: 1, SUCCESS: 4 }),
    reviewDecision: 'CHANGES_REQUESTED',
  }),
  prNode({
    number: 103,
    title: 'Upgrade database connection pool',
    repository: 'acme/api',
    commits: headCommit({ PENDING: 2, SUCCESS: 3 }),
  }),
  prNode({
    number: 104,
    title: 'Draft: refresh the dashboard',
    repository: 'acme/web',
    isDraft: true,
    mergeStateStatus: 'DRAFT',
  }),
  prNode({
    number: 105,
    title: 'Resolve API pagination conflicts',
    repository: 'acme/api',
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
  }),
].map((node) => ({
  ...node,
  createdAt: now,
  updatedAt: now,
  author: { __typename: 'User', login: 'octocat', avatarUrl: '' },
}));

function operation(name: string, variables: Record<string, unknown>): object {
  if (name === 'ProwlViewer')
    return { viewer: { login: 'octocat', name: 'Demo User', avatarUrl: '' } };
  if (name === 'ProwlSearch')
    return searchResponse(
      nodes.filter((node) => node.state === 'OPEN'),
      variables,
    );
  if (name === 'ProwlMergeState') return mergeStateResponse(variables.ids, nodes);
  if (name === 'ProwlNodes')
    return nodesResponse(
      variables.ids,
      nodes.map((node) =>
        closedNode(node.id, {
          state: node.state,
          updatedAt: node.updatedAt,
        }),
      ),
    );
  if (name === 'ProwlPullRequestDetail') return pullRequestDetail(variables.id);
  return mutation(name, variables);
}

function pullRequestDetail(id: unknown): object {
  const node = nodes.find((item) => item.id === id);
  if (!node) return detailResponse(null);
  const counts =
    node.commits.nodes?.[0]?.commit.statusCheckRollup?.contexts.checkRunCountsByState ?? [];
  const checks = counts.flatMap(({ state, count }) =>
    Array.from({ length: count }, (_, index) =>
      checkRunNode(index === 0 ? 'Unit tests' : `Check ${index + 1}`, state),
    ),
  );
  const reviews =
    node.reviewDecision === 'APPROVED'
      ? [{ state: 'APPROVED', author: { login: 'alice', avatarUrl: '' } }]
      : [];
  return detailResponse(detailNode({ checks, latestReviews: { nodes: reviews } }));
}

function mutation(name: string, variables: Record<string, unknown>): object {
  const node = nodes.find((item) => item.id === variables.id);
  if (!node) throw new Error(`No mock for ${name}`);
  node.updatedAt = new Date().toISOString();
  switch (name) {
    case 'ProwlApprove':
    case 'ProwlRequestChanges':
      node.reviewDecision = name === 'ProwlApprove' ? 'APPROVED' : 'CHANGES_REQUESTED';
      return { addPullRequestReview: { pullRequestReview: { id: 'mock-review' } } };
    case 'ProwlComment':
      node.totalCommentsCount = (node.totalCommentsCount ?? 0) + 1;
      return { addComment: { commentEdge: { node: { id: 'mock-comment' } } } };
    case 'ProwlMerge':
      node.state = 'MERGED';
      return { mergePullRequest: { pullRequest: { merged: true } } };
    case 'ProwlMarkReady':
    case 'ProwlConvertToDraft': {
      node.isDraft = name === 'ProwlConvertToDraft';
      const key = node.isDraft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
      return { [key]: { pullRequest: { isDraft: node.isDraft } } };
    }
    case 'ProwlUpdateBranch':
      node.mergeStateStatus = 'CLEAN';
      return { updatePullRequestBranch: { pullRequest: { headRefOid: node.headRefOid } } };
    case 'ProwlEnableAutoMerge':
    case 'ProwlDisableAutoMerge': {
      const enabled = name === 'ProwlEnableAutoMerge';
      node.autoMergeRequest = enabled
        ? { mergeMethod: String(variables.method), enabledBy: { login: 'octocat' } }
        : null;
      return {
        [enabled ? 'enablePullRequestAutoMerge' : 'disablePullRequestAutoMerge']: {
          pullRequest: { autoMergeRequest: node.autoMergeRequest },
        },
      };
    }
    case 'ProwlFailedSuites':
      return failedSuites(node);
    default:
      throw new Error(`No mock for ${name}`);
  }
}

function failedSuites(node: (typeof nodes)[number]): object {
  return {
    node: {
      repository: node.repository,
      commits: {
        nodes: [
          {
            commit: {
              checkSuites: {
                nodes: [{ databaseId: 1, conclusion: 'FAILURE', workflowRun: { databaseId: 1 } }],
              },
            },
          },
        ],
      },
    },
  };
}

/** Every application fetch stays in memory; unhandled requests fail visibly. */
export function installMockApi(): void {
  const browserFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin === location.origin) return browserFetch(input, init);
    if (url.origin !== 'https://mock.prowl.test')
      throw new Error(`Preview blocked request: ${url.origin}`);
    let body: unknown;
    if (url.pathname === '/graphql') {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const name = /(?:query|mutation)\s+(\w+)/.exec(request.query)?.[1] ?? '';
      body = { data: operation(name, request.variables) };
    } else if (url.pathname === '/user') {
      body = { login: 'octocat', name: 'Demo User', avatar_url: '' };
    } else if (url.pathname === '/user/teams') {
      body = [];
    } else if (url.pathname.endsWith('/rerun-failed-jobs')) {
      for (const node of nodes) node.commits = headCommit({ PENDING: 5 });
      return new Response(null, { status: 204 });
    } else {
      throw new Error(`No preview mock for ${url.pathname}`);
    }
    return Response.json(body, { headers: { 'x-oauth-scopes': 'repo, read:org' } });
  };
}
