/**
 * What changed between two polls, as `PrEvent`s for the notifier. Pure. PRs are compared one
 * by one; a PR that is only in one of the snapshots produces nothing: it is new (no baseline)
 * or it simply left the search scope.
 */
import type { PrEvent, PrEventType, PullRequest, ReviewState, Snapshot } from '../model';
import { ciOutcome } from './checkTransitions';

/** Dismissed reviews no longer count, so they are not news. */
const REVIEW_EVENTS: Partial<Record<ReviewState, PrEventType>> = {
  approved: 'approved',
  changes_requested: 'changes_requested',
  commented: 'review_new',
};

/**
 * Open, not a draft, mergeable, and GitHub's verdict lets it through (`clean`; `unstable` means
 * only a check that is not required fails; `has_hooks`) with its review requirement met or
 * absent. Local facts never override a `blocked`, `behind` or `unknown` verdict.
 */
export function isReadyToMerge(pr: PullRequest): boolean {
  return (
    pr.state === 'open' &&
    !pr.isDraft &&
    pr.mergeable === 'mergeable' &&
    ['clean', 'unstable', 'has_hooks'].includes(pr.mergeStateStatus) &&
    (pr.reviewDecision === 'approved' || pr.reviewDecision === 'none')
  );
}

export { carrySettledChecks } from './checkTransitions';

/**
 * Events for the changes from `prev` to `next`, oldest first. `prev` null (first poll) or taken
 * for another account gives none. Changes the viewer made (their reviews, comments, merges)
 * are left out. Ids are `<pr id>:<type>:<key>` and do not depend on when the poll ran, so a
 * repeated poll yields the same ids; `at` is GitHub's time, or `next.fetchedAt` for check and
 * ready-to-merge changes, whose time the snapshot does not carry.
 */
export function diffSnapshots(
  prev: Snapshot | null,
  next: Snapshot,
  viewerLogin: string,
): PrEvent[] {
  const viewer = viewerLogin.toLowerCase();
  if (!prev || prev.viewer.login.toLowerCase() !== viewer) return [];
  const isViewer = (login: string | null) => login?.toLowerCase() === viewer;
  const events = new Map<string, PrEvent>();

  for (const pr of Object.values(next.pullRequests)) {
    const before = prev.pullRequests[pr.id];
    if (!before) continue;
    const { id: prId, repo, number, title, url } = pr;
    const add = (type: PrEventType, key: string, actor: string | null, at: string) => {
      const id = `${prId}:${type}:${key}`;
      events.set(id, { id, type, prId, repo: repo.nameWithOwner, number, title, url, actor, at });
    };

    const outcome = ciOutcome(prev, before, pr);
    if (outcome)
      add(outcome, `${pr.headSha}:${(prev.ciOutcomes?.[pr.id] ?? 0) + 1}`, null, next.fetchedAt);

    const known = new Set(before.reviews.map(({ id }) => id));
    for (const review of pr.reviews) {
      const type = REVIEW_EVENTS[review.state];
      if (type && !known.has(review.id) && !isViewer(review.author))
        add(type, review.id, review.author, review.submittedAt);
    }

    // The count includes review comments, which the review events already report: only a
    // newer latest issue comment is a new comment.
    const comment = pr.lastComment;
    if (
      comment &&
      pr.commentCount > before.commentCount &&
      comment.createdAt > (before.lastComment?.createdAt ?? '') &&
      !isViewer(comment.author)
    )
      add('comment_new', comment.createdAt, comment.author, comment.createdAt);

    if (isReadyToMerge(pr) && !isReadyToMerge(before))
      add('ready_to_merge', pr.headSha, null, next.fetchedAt);

    if (before.state === 'open' && pr.state !== 'open' && !isViewer(pr.closedBy))
      add(pr.state, pr.headSha, pr.closedBy, pr.updatedAt);
  }
  return [...events.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
