/** `ProwlPullRequestDetail` nodes -> `PullRequestDetail` (panel only, see detailQuery.ts). */
import { t } from '../i18n';
import type { CheckItem, CheckItemState, PullRequestDetail, Reviewer } from '../model';
import { isGitHubUrl } from '../url';
import type { CheckRunNode, DetailPullRequestNode, StatusContextNode } from './detailQuery';
import { BUCKET, GHOST, limitedConnections, pick, present, REVIEW_STATES } from './mapPullRequest';

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
  // A third-party CI's details page is off GitHub, which the panel never opens: fall back to the
  // check run's own GitHub page, which links to it. Commit statuses have no GitHub page.
  const url = run
    ? node.detailsUrl && isGitHubUrl(node.detailsUrl)
      ? node.detailsUrl
      : (node.url ?? node.detailsUrl)
    : node.targetUrl;
  return {
    name: run ? node.name : node.context,
    state: BUCKET[state] ?? 'neutral',
    url: url && HTTP_URL.test(url) ? url : null,
    required: typeof node.isRequired === 'boolean' ? node.isRequired : null,
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
  const warnings = limitedConnections({
    reviews: node.latestReviews,
    'review requests': node.reviewRequests,
  }).map((name) => t(name === 'reviews' ? 'reviewsNotLoaded' : 'reviewRequestsNotLoaded'));
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
    ...(warnings.length ? { warnings } : {}),
    requiredApprovals: rule?.requiredApprovingReviewCount ?? null,
    requiresConversationResolution: rule?.requiresConversationResolution ?? false,
    ...deploymentsOf(pages[0]),
    ...commitTitlesOf(pages[0]),
    ...(node.isMergeQueueEnabled
      ? {
          mergeQueue: node.mergeQueueEntry
            ? {
                position: node.mergeQueueEntry.position,
                estimatedSeconds: node.mergeQueueEntry.estimatedTimeToMerge,
              }
            : null,
        }
      : {}),
  };
}

const DEPLOY_STATE: Record<string, CheckItemState> = {
  SUCCESS: 'passed',
  FAILURE: 'failed',
  ERROR: 'failed',
  PENDING: 'pending',
  QUEUED: 'pending',
  IN_PROGRESS: 'pending',
  WAITING: 'pending',
};

/** The head commit's deployments, newest per environment; inactive ones are left out. */
function deploymentsOf(node: DetailPullRequestNode): Pick<PullRequestDetail, 'deployments'> {
  const seen = new Set<string>();
  const deployments = present(node.commits.nodes?.at(-1)?.commit.deployments ?? null)
    .reverse()
    .flatMap(({ latestEnvironment: environment, latestStatus: status }) => {
      const state = status && DEPLOY_STATE[status.state];
      if (!environment || !state || seen.has(environment)) return [];
      seen.add(environment);
      const url =
        status.environmentUrl && HTTP_URL.test(status.environmentUrl)
          ? status.environmentUrl
          : null;
      return [{ environment, state, url }];
    });
  return deployments.length ? { deployments } : {};
}

/**
 * GitHub's own default titles, so the merge dialog starts on them: a squash takes the PR title
 * (or, set to COMMIT_OR_PR_TITLE, the commit's when there is one commit), a merge commit "Merge
 * pull request #N from owner/branch" (or the PR title); both add "(#N)" when they use a title.
 */
function commitTitlesOf(node: DetailPullRequestNode): Pick<PullRequestDetail, 'commitTitles'> {
  const { number, title, repository: repo, firstCommit } = node;
  if (number === undefined || title === undefined || !repo) return {};
  const only =
    firstCommit?.totalCount === 1 ? firstCommit.nodes?.[0]?.commit.messageHeadline : undefined;
  const squash = `${repo.squashMergeCommitTitle === 'COMMIT_OR_PR_TITLE' && only ? only : title} (#${number})`;
  const merge =
    repo.mergeCommitTitle === 'PR_TITLE'
      ? `${title} (#${number})`
      : `Merge pull request #${number} from ${node.headRepositoryOwner?.login ?? 'ghost'}/${node.headRefName ?? ''}`;
  return { commitTitles: { squash, merge } };
}
