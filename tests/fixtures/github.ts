/**
 * Builders for GitHub-shaped GraphQL data (PR nodes, search and nodes responses, viewer),
 * shared by unit tests and the E2E mock: `github.onGraphQL('ProwlSearch', (vars) =>
 * searchResponse(prs, vars))`. Defaults describe one open, mergeable PR with passing checks.
 */
import type {
  CheckRunNode,
  ClosedPullRequestNode,
  DetailData,
  DetailPullRequestNode,
  NodesData,
  PullRequestNode,
  SearchData,
  StateCount,
  StatusContextNode,
} from '../../src/lib/github/queries';
import type { Viewer } from '../../src/lib/model';
import { graphqlRateLimit } from './http';

const WEB = 'https://github.com';
const AVATAR = 'https://avatars.githubusercontent.com/u/583231?s=64&v=4';
/**
 * Default `committedDate`: when the tests started, in GitHub's format. Fixed dates would make
 * every default PR "no commit for 20 days" (hidden) on later runs; set it to test staleness.
 */
export const RECENT_COMMIT = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** `viewer { login avatarUrl name }`. */
export function viewerNode(overrides: Partial<Viewer> = {}): Viewer {
  return { login: 'octocat', avatarUrl: AVATAR, name: 'The Octocat', ...overrides };
}

/** The node id GitHub would give PR `number` of `nameWithOwner` (stable per pair). */
export const prId = (number: number, nameWithOwner = 'acme/widgets') =>
  `PR_${nameWithOwner.replace('/', '_')}_${number}`;

export function repositoryNode(nameWithOwner = 'acme/widgets', overrides = {}) {
  const [owner = '', name = ''] = nameWithOwner.split('/');
  return {
    name,
    nameWithOwner,
    owner: { login: owner },
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: false,
    viewerDefaultMergeMethod: 'MERGE',
    viewerPermission: 'WRITE',
    autoMergeAllowed: false,
    ...overrides,
  };
}

/**
 * `commits(last: 1)` whose head commit has these check-run and status counts (null: none) and
 * was committed at `committedDate`.
 */
export function headCommit(
  checkRuns: Record<string, number> | null = { SUCCESS: 2 },
  statuses: Record<string, number> = {},
  committedDate = RECENT_COMMIT,
): PullRequestNode['commits'] {
  const counts = (byState: Record<string, number>): StateCount[] =>
    Object.entries(byState).map(([state, count]) => ({ state, count }));
  return {
    nodes: [
      {
        commit: {
          committedDate,
          statusCheckRollup: checkRuns && {
            contexts: {
              checkRunCountsByState: counts(checkRuns),
              statusContextCountsByState: counts(statuses),
            },
          },
        },
      },
    ],
  };
}

export function reviewNode(
  login: string | null,
  state = 'APPROVED',
  submittedAt: string | null = '2026-10-05T10:00:00Z',
) {
  return {
    id: `PRR_${login ?? 'ghost'}_${state}_${submittedAt ?? 'pending'}`,
    state,
    submittedAt,
    author: login === null ? null : { login },
  };
}

/** A PR as `ProwlSearch` returns it. `repository` is an `owner/name` shortcut. */
export function prNode(
  overrides: Partial<Omit<PullRequestNode, 'repository'>> & { repository?: string } = {},
): PullRequestNode {
  const { repository = 'acme/widgets', ...fields } = overrides;
  const number = fields.number ?? 1;
  return {
    id: prId(number, repository),
    number,
    title: `Improve widget ${number}`,
    url: `${WEB}/${repository}/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    headRefName: `feature-${number}`,
    baseRefName: 'main',
    headRefOid: 'a'.repeat(40),
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-05T12:00:00Z',
    author: { __typename: 'User', login: 'octocat', avatarUrl: AVATAR },
    mergedBy: null,
    repository: repositoryNode(repository),
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    viewerCanUpdate: true,
    autoMergeRequest: null,
    totalCommentsCount: 0,
    labels: { nodes: [] },
    latestReviews: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    commits: headCommit(),
    ...fields,
  };
}

/**
 * The `data` of a `ProwlSearch` page over `nodes`, paginated by `first` / `after` the way
 * GitHub does (opaque cursors, here the index of the next node).
 */
export function searchResponse(
  nodes: SearchData['search']['nodes'],
  { first = 50, after = null }: { first?: unknown; after?: unknown } = {},
  rateLimit = graphqlRateLimit(),
): SearchData {
  const all = nodes ?? [];
  const start = typeof after === 'string' ? Number(after) : 0;
  const end = start + Number(first);
  return {
    search: {
      pageInfo: { hasNextPage: end < all.length, endCursor: all.length ? String(end) : null },
      nodes: all.slice(start, end),
    },
    rateLimit,
  };
}

/** A merged (`by` set) or closed PR as `ProwlNodes` returns it. */
export function closedNode(
  id: string,
  {
    state = 'MERGED',
    by = 'octocat',
    updatedAt = '2026-10-06T08:00:00Z',
  }: { state?: string; by?: string | null; updatedAt?: string } = {},
): ClosedPullRequestNode {
  const merged = state === 'MERGED';
  return {
    id,
    state,
    merged,
    updatedAt,
    mergedBy: merged && by ? { login: by } : null,
    timelineItems: { nodes: state === 'OPEN' ? [] : [{ actor: by ? { login: by } : null }] },
  };
}

/** The `data` of `ProwlNodes` for `ids`: the matching node, or null (deleted PR). */
export function nodesResponse(
  ids: unknown,
  nodes: NodesData['nodes'],
  rateLimit = graphqlRateLimit(),
): NodesData {
  const byId = new Map(nodes.map((node) => [node?.id, node]));
  return {
    nodes: (Array.isArray(ids) ? ids : []).map((id) => byId.get(id) ?? null),
    rateLimit,
  };
}

/** States of a check run that is still going; any other `CheckRunState` is a conclusion. */
const RUNNING = ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'];

/** A check run as `ProwlPullRequestDetail` returns it, from a `CheckRunState` name. */
export function checkRunNode(
  name: string,
  state = 'SUCCESS',
  overrides: Partial<CheckRunNode> = {},
): CheckRunNode {
  const running = RUNNING.includes(state);
  return {
    __typename: 'CheckRun',
    name,
    status: running ? state : 'COMPLETED',
    conclusion: running ? null : state,
    detailsUrl: `${WEB}/acme/widgets/actions/runs/1/job/${encodeURIComponent(name)}`,
    isRequired: false,
    ...overrides,
  };
}

/** A commit status (a third-party CI) as `ProwlPullRequestDetail` returns it. */
export function statusContextNode(
  context: string,
  state = 'SUCCESS',
  overrides: Partial<StatusContextNode> = {},
): StatusContextNode {
  return {
    __typename: 'StatusContext',
    context,
    state,
    targetUrl: `${WEB}/acme/widgets/status/${encodeURIComponent(context)}`,
    isRequired: false,
    ...overrides,
  };
}

/** `latestReviews` entry with the avatar the detail query selects. */
export function detailReview(login: string | null, state = 'APPROVED') {
  return { state, author: login === null ? null : { login, avatarUrl: AVATAR } };
}

/** `reviewRequests` entry for a user (`{}` instead for a team, which is not selected). */
export function requestedReviewer(login: string | null) {
  return { requestedReviewer: login === null ? {} : { login, avatarUrl: AVATAR } };
}

/**
 * The PR node of `ProwlPullRequestDetail`: one page of `checks` (`pageSize` per page from the
 * `after` cursor, the index of the next one, like `searchResponse`) and any field overridden.
 * Defaults: a protected base branch asking for one approval, nobody reviewing yet.
 */
export function detailNode({
  checks = [],
  after = null,
  pageSize = 100,
  ...fields
}: Partial<DetailPullRequestNode> & {
  checks?: (CheckRunNode | StatusContextNode | null)[];
  after?: unknown;
  pageSize?: number;
} = {}): DetailPullRequestNode {
  const start = typeof after === 'string' ? Number(after) : 0;
  const end = start + pageSize;
  return {
    latestReviews: { nodes: [] },
    reviewRequests: { nodes: [] },
    baseRef: {
      branchProtectionRule: {
        requiredApprovingReviewCount: 1,
        requiresConversationResolution: false,
      },
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                totalCount: checks.length,
                pageInfo: { hasNextPage: end < checks.length, endCursor: String(end) },
                nodes: checks.slice(start, end),
              },
            },
          },
        },
      ],
    },
    ...fields,
  };
}

/** The `data` of `ProwlPullRequestDetail`; null node = a PR that is gone. */
export function detailResponse(
  node: DetailData['node'],
  rateLimit = graphqlRateLimit(),
): DetailData {
  return { node, rateLimit };
}

/** One item of REST `GET /user/teams` (GitHub's "Full Team"), for `org/slug`. */
export function teamJson(key = 'acme/core', name = 'Core') {
  const [org = '', slug = ''] = key.split('/');
  return {
    id: 4_200_001,
    node_id: 'T_kwDOAAAB0c4AQBIx',
    url: `https://api.github.com/organizations/1001/team/4200001`,
    html_url: `${WEB}/orgs/${org}/teams/${slug}`,
    name,
    slug,
    description: null,
    privacy: 'closed',
    notification_setting: 'notifications_enabled',
    permission: 'pull',
    parent: null,
    members_count: 4,
    repos_count: 2,
    created_at: '2024-02-01T09:00:00Z',
    updated_at: '2026-09-30T09:00:00Z',
    organization: {
      login: org,
      id: 1001,
      node_id: 'O_kgDOAAAD6Q',
      url: `https://api.github.com/orgs/${org}`,
      avatar_url: AVATAR,
      description: null,
    },
  };
}

/**
 * A REST answer for `GET /user/teams?per_page&page`, paged like GitHub (`teams` is every team,
 * `path` the request path with its query).
 */
export function userTeamsPage(teams: ReturnType<typeof teamJson>[], path: string) {
  const params = new URL(path, 'https://api.github.com').searchParams;
  const perPage = Number(params.get('per_page') ?? 30);
  const page = Number(params.get('page') ?? 1);
  return teams.slice((page - 1) * perPage, page * perPage);
}
