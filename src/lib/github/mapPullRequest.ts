/**
 * GitHub GraphQL nodes -> `PullRequest` of `src/lib/model.ts`. The only place that reads raw
 * PR JSON. Enum values GitHub may add later map to safe defaults instead of leaking through.
 */
import type {
  CheckSummary,
  Label,
  Mergeable,
  MergeMethod,
  MergeStateStatus,
  PullRequest,
  PullRequestState,
  ReviewDecision,
  ReviewState,
} from '../model';
import type { ClosedPullRequestNode, Nodes, PullRequestNode, StateCount } from './queries';

/** GitHub's name for a deleted account. */
const GHOST = 'ghost';
/** Used when a label color is not six hex digits. */
export const NEUTRAL_LABEL_COLOR = 'ededed';
const HEX_COLOR = /^[0-9a-f]{6}$/i;

const PR_STATES: readonly PullRequestState[] = ['open', 'closed', 'merged'];
const REVIEW_DECISIONS: readonly ReviewDecision[] = [
  'approved',
  'changes_requested',
  'review_required',
];
const REVIEW_STATES: readonly ReviewState[] = [
  'approved',
  'changes_requested',
  'commented',
  'dismissed',
];
const MERGEABLE: readonly Mergeable[] = ['mergeable', 'conflicting', 'unknown'];
const MERGE_STATE_STATUSES: readonly MergeStateStatus[] = [
  'clean',
  'blocked',
  'behind',
  'dirty',
  'draft',
  'has_hooks',
  'unstable',
  'unknown',
];

/** GitHub's upper-case enum value lower-cased when the model knows it, else `fallback`. */
function pick<T extends string, F>(
  allowed: readonly T[],
  value: string | null,
  fallback: F,
): T | F {
  const lower = value?.toLowerCase() ?? '';
  return (allowed as readonly string[]).includes(lower) ? (lower as T) : fallback;
}

/** The nodes of a connection without the holes left by failed reads. */
const present = <T>(connection: Nodes<T> | null): T[] =>
  (connection?.nodes ?? []).filter((node): node is T => node !== null);

type Bucket = 'passed' | 'failed' | 'pending' | 'neutral';

/**
 * `CheckRunState` and `StatusState` (which share SUCCESS / FAILURE / PENDING) -> bucket.
 * Everything else is neutral: NEUTRAL, SKIPPED, CANCELLED, STALE, COMPLETED and new values.
 */
const BUCKET: Record<string, Bucket> = {
  SUCCESS: 'passed',
  FAILURE: 'failed',
  ERROR: 'failed',
  TIMED_OUT: 'failed',
  STARTUP_FAILURE: 'failed',
  ACTION_REQUIRED: 'failed',
  PENDING: 'pending',
  EXPECTED: 'pending',
  QUEUED: 'pending',
  IN_PROGRESS: 'pending',
  WAITING: 'pending',
};

/**
 * Summary of the head commit's checks, from the per-state counts. The state is derived from
 * the counts rather than read from `statusCheckRollup.state`, which reports a cancelled run
 * as a failure and changes when `contexts` is selected in the same query.
 */
function mapChecks(counts: StateCount[]): CheckSummary {
  const summary: CheckSummary = {
    state: 'none',
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    neutral: 0,
  };
  for (const { state, count } of counts) {
    summary[BUCKET[state] ?? 'neutral'] += count;
    summary.total += count;
  }
  if (summary.failed > 0) summary.state = 'failure';
  else if (summary.pending > 0) summary.state = 'pending';
  else if (summary.total > 0) summary.state = 'success';
  return summary;
}

const mapLabel = ({ name, color }: { name: string; color: string }): Label => ({
  name,
  color: HEX_COLOR.test(color) ? color.toLowerCase() : NEUTRAL_LABEL_COLOR,
});

export function mapPullRequest(node: PullRequestNode): PullRequest {
  const { repository: repo } = node;
  const contexts = node.commits.nodes?.at(-1)?.commit.statusCheckRollup?.contexts;
  const lastComment = present(node.comments).at(-1);
  const methods: [boolean, MergeMethod][] = [
    [repo.mergeCommitAllowed, 'merge'],
    [repo.squashMergeAllowed, 'squash'],
    [repo.rebaseMergeAllowed, 'rebase'],
  ];
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repo: { owner: repo.owner.login, name: repo.name, nameWithOwner: repo.nameWithOwner },
    author: node.author && { login: node.author.login, avatarUrl: node.author.avatarUrl },
    state: pick(PR_STATES, node.state, 'open'),
    isDraft: node.isDraft,
    headRefName: node.headRefName,
    baseRefName: node.baseRefName,
    headSha: node.headRefOid,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    checks: mapChecks([
      ...(contexts?.checkRunCountsByState ?? []),
      ...(contexts?.statusContextCountsByState ?? []),
    ]),
    reviewDecision: pick(REVIEW_DECISIONS, node.reviewDecision, 'none'),
    reviews: present(node.latestReviews)
      .flatMap(({ id, state, submittedAt, author }) => {
        const mapped = pick(REVIEW_STATES, state, null);
        return mapped && submittedAt
          ? [{ id, author: author?.login ?? GHOST, state: mapped, submittedAt }]
          : [];
      })
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    requestedReviewers: present(node.reviewRequests).flatMap(
      ({ requestedReviewer }) => requestedReviewer?.login ?? [],
    ),
    mergeable: pick(MERGEABLE, node.mergeable, 'unknown'),
    mergeStateStatus: pick(MERGE_STATE_STATUSES, node.mergeStateStatus, 'unknown'),
    labels: present(node.labels).map(mapLabel),
    // ponytail: counts the first 100 threads; PRs with more under-report unresolved threads.
    unresolvedThreads: present(node.reviewThreads).filter(({ isResolved }) => !isResolved).length,
    commentCount: node.totalCommentsCount ?? 0,
    lastComment: lastComment
      ? { author: lastComment.author?.login ?? GHOST, createdAt: lastComment.createdAt }
      : null,
    // A search result does not carry the ClosedEvent: closed PRs get their closer from
    // `mapClosedState`, merged ones from `mergedBy`.
    closedBy: node.mergedBy?.login ?? null,
    allowedMergeMethods: methods.flatMap(([allowed, method]) => (allowed ? [method] : [])),
    viewerCanUpdate: node.viewerCanUpdate,
  };
}

/**
 * Applies the final state of a PR that left every section (`ProwlNodes`) to its last known
 * copy. Returns null while it is still open: it only stopped matching the searches.
 */
export function mapClosedState(pr: PullRequest, node: ClosedPullRequestNode): PullRequest | null {
  const state = node.merged ? 'merged' : pick(PR_STATES, node.state, 'open');
  if (state === 'open') return null;
  const closer = present(node.timelineItems).at(-1)?.actor?.login;
  return {
    ...pr,
    state,
    updatedAt: node.updatedAt,
    closedBy: node.mergedBy?.login ?? closer ?? null,
  };
}
