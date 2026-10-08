/**
 * GitHub GraphQL nodes -> `PullRequest` of `src/lib/model.ts`. The only place that reads raw
 * PR JSON. Enum values GitHub may add later map to safe defaults instead of leaking through.
 */
import type {
  CheckItem,
  CheckItemState,
  CheckSummary,
  Label,
  Mergeable,
  MergeMethod,
  MergeStateStatus,
  PullRequest,
  PullRequestDetail,
  PullRequestState,
  ReviewDecision,
  Reviewer,
  ReviewState,
} from '../model';
import type {
  CheckRunNode,
  ClosedPullRequestNode,
  DetailPullRequestNode,
  MergeStateNode,
  Nodes,
  PullRequestNode,
  StateCount,
  StatusContextNode,
} from './queries';

/** GitHub's name for a deleted account. */
const GHOST = 'ghost';
/** REST spells a bot's login `dependabot[bot]`; GraphQL gives `dependabot` and `__typename: Bot`. */
const BOT_SUFFIX = '[bot]';
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
const MERGE_METHODS: readonly MergeMethod[] = ['merge', 'squash', 'rebase'];
/** `RepositoryPermission` levels that can merge a pull request. */
const CAN_MERGE = ['WRITE', 'MAINTAIN', 'ADMIN'];
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

/**
 * `CheckRunState`, `CheckStatusState` and `StatusState` (which share SUCCESS / FAILURE /
 * PENDING) -> bucket. Everything else is neutral: NEUTRAL, SKIPPED, CANCELLED, STALE, COMPLETED
 * and new values.
 */
const BUCKET: Record<string, CheckItemState> = {
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
  REQUESTED: 'pending',
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

/** The fields `ProwlMergeState` reads (see `MERGE_STATE_QUERY`). */
export type MergeFacts = Pick<
  PullRequest,
  'reviewDecision' | 'mergeable' | 'mergeStateStatus' | 'viewerCanUpdate'
>;

/** Merge facts of a node; what it does not carry is unknown (none, unknown, false). */
export function mapMergeState(node: Partial<MergeStateNode>): MergeFacts {
  return {
    reviewDecision: pick(REVIEW_DECISIONS, node.reviewDecision ?? null, 'none'),
    mergeable: pick(MERGEABLE, node.mergeable ?? null, 'unknown'),
    mergeStateStatus: pick(MERGE_STATE_STATUSES, node.mergeStateStatus ?? null, 'unknown'),
    viewerCanUpdate: node.viewerCanUpdate === true,
  };
}

/** A search result; its merge facts are unknown until `mapMergeState` fills them in. */
export function mapPullRequest(node: PullRequestNode & Partial<MergeStateNode>): PullRequest {
  const { repository: repo } = node;
  const head = node.commits.nodes?.at(-1)?.commit;
  const contexts = head?.statusCheckRollup?.contexts;
  const lastComment = present(node.comments).at(-1);
  const allowed = [repo.mergeCommitAllowed, repo.squashMergeAllowed, repo.rebaseMergeAllowed];
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repo: { owner: repo.owner.login, name: repo.name, nameWithOwner: repo.nameWithOwner },
    author: node.author && {
      login: node.author.login,
      avatarUrl: node.author.avatarUrl,
      isBot: node.author.__typename === 'Bot' || node.author.login.endsWith(BOT_SUFFIX),
    },
    state: pick(PR_STATES, node.state, 'open'),
    isDraft: node.isDraft,
    headRefName: node.headRefName,
    baseRefName: node.baseRefName,
    headSha: node.headRefOid,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    // A head commit that failed to load counts as the last activity: a read error alone never
    // hides a PR that something recently happened on.
    lastCommitAt: head?.committedDate ?? node.updatedAt,
    checks: mapChecks([
      ...(contexts?.checkRunCountsByState ?? []),
      ...(contexts?.statusContextCountsByState ?? []),
    ]),
    ...mapMergeState(node),
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
    allowedMergeMethods: MERGE_METHODS.filter((_, index) => allowed[index]),
    defaultMergeMethod: pick(MERGE_METHODS, repo.viewerDefaultMergeMethod, 'merge'),
    viewerCanMerge: CAN_MERGE.includes(repo.viewerPermission ?? ''),
    autoMergeAllowed: repo.autoMergeAllowed === true,
    autoMerge: node.autoMergeRequest
      ? {
          method: pick(MERGE_METHODS, node.autoMergeRequest.mergeMethod, 'merge'),
          enabledBy: node.autoMergeRequest.enabledBy?.login ?? null,
        }
      : null,
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

const CHECK_ORDER: Record<CheckItemState, number> = {
  failed: 0,
  pending: 1,
  passed: 2,
  neutral: 3,
};
const REVIEWER_ORDER: Record<Reviewer['state'], number> = {
  changes_requested: 0,
  requested: 1,
  approved: 2,
  commented: 3,
  dismissed: 4,
};
const HTTP_URL = /^https?:\/\//i;

/** A check run's state is its conclusion once it completed, else where it is in its run. */
function mapContext(node: CheckRunNode | StatusContextNode): CheckItem {
  const run = node.__typename === 'CheckRun';
  const state = run
    ? node.status === 'COMPLETED'
      ? (node.conclusion ?? '')
      : node.status
    : node.state;
  const url = run ? node.detailsUrl : node.targetUrl;
  return {
    name: run ? node.name : node.context,
    state: BUCKET[state] ?? 'neutral',
    // ponytail: the panel only opens URLs on the GitHub origin, so third-party CI links are text.
    url: url !== null && HTTP_URL.test(url) ? url : null,
    required: node.isRequired === true,
  };
}

/**
 * Detail of an expanded card (`ProwlPullRequestDetail`). `pages` are the PR node of each page of
 * check contexts, first page first: reviewers and branch rules come from the first, the checks
 * from all. A reviewer who reviewed shows that review even when asked to review again.
 */
export function mapPullRequestDetail(
  pages: [DetailPullRequestNode, ...DetailPullRequestNode[]],
): PullRequestDetail {
  const [node] = pages;
  const rollups = pages.flatMap(
    (page) => page.commits.nodes?.at(-1)?.commit.statusCheckRollup?.contexts ?? [],
  );
  const rule = node.baseRef?.branchProtectionRule;
  const reviewed: Reviewer[] = present(node.latestReviews).flatMap(({ state, author }) => {
    const mapped = pick(REVIEW_STATES, state, null);
    return mapped
      ? [{ login: author?.login ?? GHOST, avatarUrl: author?.avatarUrl ?? '', state: mapped }]
      : [];
  });
  const requested: Reviewer[] = present(node.reviewRequests).flatMap(
    ({ requestedReviewer: who }) =>
      who?.login && !reviewed.some(({ login }) => login === who.login)
        ? [{ login: who.login, avatarUrl: who.avatarUrl ?? '', state: 'requested' as const }]
        : [],
  );
  return {
    checks: rollups
      .flatMap(({ nodes }) => (nodes ?? []).flatMap((check) => (check ? [mapContext(check)] : [])))
      .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state]),
    checksTotal: rollups[0]?.totalCount ?? 0,
    reviewers: [...reviewed, ...requested].sort(
      (a, b) => REVIEWER_ORDER[a.state] - REVIEWER_ORDER[b.state],
    ),
    requiredApprovals: rule?.requiredApprovingReviewCount || null,
    requiresConversationResolution: rule?.requiresConversationResolution ?? false,
  };
}
