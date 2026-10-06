/**
 * Builders for GitHub-shaped GraphQL data (PR nodes, search and nodes responses, viewer),
 * shared by unit tests and the E2E mock: `github.onGraphQL('ProwlSearch', (vars) =>
 * searchResponse(prs, vars))`. Defaults describe one open, mergeable PR with passing checks.
 */
import type {
  ClosedPullRequestNode,
  NodesData,
  PullRequestNode,
  SearchData,
  StateCount,
} from '../../src/lib/github/queries';
import type { Viewer } from '../../src/lib/model';
import { graphqlRateLimit } from './http';

const WEB = 'https://github.com';
const AVATAR = 'https://avatars.githubusercontent.com/u/583231?s=64&v=4';

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
    ...overrides,
  };
}

/** `commits(last: 1)` whose head commit has these check-run and status counts (null: none). */
export function headCommit(
  checkRuns: Record<string, number> | null = { SUCCESS: 2 },
  statuses: Record<string, number> = {},
): PullRequestNode['commits'] {
  const counts = (byState: Record<string, number>): StateCount[] =>
    Object.entries(byState).map(([state, count]) => ({ state, count }));
  return {
    nodes: [
      {
        commit: {
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
    author: { login: 'octocat', avatarUrl: AVATAR },
    mergedBy: null,
    repository: repositoryNode(repository),
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    viewerCanUpdate: true,
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
