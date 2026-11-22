/**
 * What changed between two polls, as `PrEvent`s for the notifier. Pure. PRs are compared one
 * by one. A PR only in `prev` gives nothing: it simply left the search scope. A PR only in
 * `next` has no baseline: it only says when it arrived as the viewer's move (see `arrived`).
 */
import type { PrEvent, PrEventType, PullRequest, ReviewState, Snapshot } from '../model';
import { turnIn } from '../turn/whoseTurn';
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

type Add = (type: PrEventType, key: string, actor: string | null, at: string) => void;

/**
 * Up to when `prev` saw GitHub, in GitHub's time: its local fetch time, or the newest update it
 * read when that is earlier, so a local clock running ahead never hides a change.
 */
function seenUntil(prev: Snapshot): number {
  const fetched = Date.parse(prev.fetchedAt);
  const updates = Object.values(prev.pullRequests).map(({ updatedAt }) => Date.parse(updatedAt));
  return updates.length ? Math.min(fetched, Math.max(...updates)) : fetched;
}

/**
 * A PR new to `prev` is news when GitHub changed it since and a section of `next` found it with
 * the search `prev` ran too (`sectionScopes`). One that only shows up because a section was
 * turned on, a query, filter or limit changed, or an earlier search missed it, is not.
 */
function arrived(prev: Snapshot, next: Snapshot, pr: PullRequest, since: number): boolean {
  if (!(Date.parse(pr.updatedAt) > since)) return false;
  return Object.entries(next.sections).some(([id, ids]) => {
    const scope = next.sectionScopes?.[id];
    return ids.includes(pr.id) && scope !== undefined && prev.sectionScopes?.[id] === scope;
  });
}

/** The events of a PR in both snapshots, except the turn. */
function changes(prev: Snapshot, next: Snapshot, before: PullRequest, pr: PullRequest, add: Add) {
  const outcome = ciOutcome(prev, before, pr);
  if (outcome)
    add(outcome, `${pr.headSha}:${(prev.ciOutcomes?.[pr.id] ?? 0) + 1}`, null, next.fetchedAt);

  const known = new Set(before.reviews.map(({ id }) => id));
  for (const review of pr.reviews) {
    const type = REVIEW_EVENTS[review.state];
    if (type && !known.has(review.id)) add(type, review.id, review.author, review.submittedAt);
  }

  // The count includes review comments, which the review events already report: only a
  // newer latest issue comment is a new comment.
  const comment = pr.lastComment;
  if (
    comment &&
    pr.commentCount > before.commentCount &&
    comment.createdAt > (before.lastComment?.createdAt ?? '')
  )
    add('comment_new', comment.createdAt, comment.author, comment.createdAt);

  // With auto-merge on, GitHub merges it itself: `merged` follows.
  if (isReadyToMerge(pr) && !pr.autoMerge && !isReadyToMerge(before))
    add('ready_to_merge', pr.headSha, null, next.fetchedAt);

  if (before.state === 'open' && pr.state !== 'open')
    add(pr.state, pr.headSha, pr.closedBy, pr.updatedAt);
}

/**
 * A PR that became the viewer's move (or arrived as it). A review asked of them is
 * `review_requested`, keyed by the update that asked; any other reason is `your_turn`.
 */
function turnChange(
  prev: Snapshot,
  next: Snapshot,
  before: PullRequest | undefined,
  pr: PullRequest,
  add: Add,
) {
  const turn = turnIn(next, pr);
  if (turn.owner !== 'you' || (before && turnIn(prev, before).owner === 'you')) return;
  if (turn.reason === 'review_requested') add('review_requested', pr.updatedAt, null, pr.updatedAt);
  else add('your_turn', `${turn.reason}:${turn.since}`, null, next.fetchedAt);
}

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
  const since = seenUntil(prev);
  const events = new Map<string, PrEvent>();

  for (const pr of Object.values(next.pullRequests)) {
    const before = prev.pullRequests[pr.id];
    if (!before && !arrived(prev, next, pr, since)) continue;
    const { id: prId, repo, number, title, url } = pr;
    let told = false;
    const add: Add = (type, key, actor, at) => {
      if (actor?.toLowerCase() === viewer) return;
      const id = `${prId}:${type}:${key}`;
      events.set(id, { id, type, prId, repo: repo.nameWithOwner, number, title, url, actor, at });
      told = true;
    };
    if (before) changes(prev, next, before, pr, add);
    // A more precise event above already tells why it is the viewer's move.
    if (!told) turnChange(prev, next, before, pr, add);
  }
  return [...events.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
