/**
 * Whose move a pull request waits for: the viewer's, a team's, someone else's, or nobody's, and
 * why. Pure, from the snapshot alone (no extra GitHub read): the list's "Your turn" section, the
 * card's turn chip, the `turn` badge and the `your_turn` notification all read it.
 */
import type { MessageKey } from '../i18n';
import { failingChecksBlock, isReadyToMerge } from '../mergeEligibility';
import type { PullRequest, Snapshot, Turn, TurnReason } from '../model';

/** The short words for each reason it is the viewer's move, on cards (the badge counts its own way). */
export const TURN_LABELS: Partial<Record<TurnReason, MessageKey>> = {
  review_requested: 'turnReviewRequested',
  re_review: 'turnReReview',
  ci_failed: 'turnCiFailed',
  changes_requested: 'turnChangesRequested',
  conflicts: 'turnConflicts',
  feedback: 'turnFeedback',
  unresolved_threads: 'turnUnresolvedThreads',
  // The words of the card's own action.
  update_branch: 'updateBranch',
  ready_to_merge: 'turnReadyToMerge',
};
/** The reasons that turn a chip or the badge red: something is broken, not just owed. */
export const RED_TURNS: ReadonlySet<TurnReason> = new Set(['ci_failed', 'changes_requested']);

const later = (a: string, b: string) => (a > b ? a : b);

/**
 * When the oldest feedback the viewer has not answered arrived: a review comment or an issue
 * comment that is neither theirs nor a bot's (Copilot code review, CodeRabbit and CI reports
 * comment after every push), newer than both the last push and the viewer's own latest review
 * or comment. Answering hands the move back as a push does. Null when there is none.
 */
function unansweredFeedback(pr: PullRequest, viewer: string): string | null {
  const isViewer = (login: string) => login.toLowerCase() === viewer;
  const comment =
    pr.lastHumanComment !== undefined
      ? pr.lastHumanComment
      : pr.lastComment?.isBot
        ? null
        : pr.lastComment;
  const replied = pr.reviews.find((r) => isViewer(r.author))?.submittedAt ?? '';
  const answered = [
    pr.lastCommitAt,
    replied,
    comment && isViewer(comment.author) ? comment.createdAt : '',
  ].reduce(later);
  const feedback = pr.reviews
    .filter((r) => r.state === 'commented' && !r.isBot && !isViewer(r.author))
    .map((r) => r.submittedAt);
  if (comment && !isViewer(comment.author)) feedback.push(comment.createdAt);
  return feedback.filter((at) => at > answered).sort()[0] ?? null;
}

/**
 * The viewer's own PR once nothing needs fixing: who merges it, or what still keeps it from
 * merging. Only facts GitHub reported decide; unread ones are nobody's yet (`merge_unknown`).
 */
function mergeTurn(pr: PullRequest, others: PullRequest['reviews']): Turn {
  const pushed = pr.lastCommitAt;
  // GitHub merges it on its own: nobody has to.
  if (pr.inMergeQueue) return { owner: 'none', reason: 'in_merge_queue', since: pr.updatedAt };
  if (isReadyToMerge(pr) && pr.autoMerge)
    return { owner: 'none', reason: 'auto_merge', since: pushed };
  const approved = others.find((r) => r.state === 'approved')?.submittedAt ?? pushed;
  if (isReadyToMerge(pr))
    return pr.viewerCanMerge
      ? { owner: 'you', reason: 'ready_to_merge', since: later(approved, pushed) }
      : { owner: 'them', reason: 'waiting_on_merge', since: later(approved, pushed) };
  const reviewed = pr.reviewDecision === 'approved' || pr.reviewDecision === 'none';
  // Strict status checks: the base moved on, and only an update lets it merge.
  if (reviewed && pr.mergeStateStatus === 'behind' && pr.viewerCanUpdate)
    return { owner: 'you', reason: 'update_branch', since: pr.updatedAt };
  // A check still running may be the required one that blocks it: wait for it first.
  if (pr.checks.state === 'pending')
    return { owner: 'them', reason: 'waiting_on_checks', since: pushed };
  // ponytail: reviewed, blocked, checks done and conversations open reads as the conversations'
  // doing; a rule the list does not see (a required check that never reported, signed commits)
  // reads the same. The card's readiness line names the real blocker once the detail loads.
  if (reviewed && pr.mergeStateStatus === 'blocked' && pr.unresolvedThreads > 0)
    return { owner: 'you', reason: 'unresolved_threads', since: later(approved, pushed) };
  if ([pr.mergeable, pr.mergeStateStatus, pr.reviewDecision].includes('unknown'))
    return { owner: 'none', reason: 'merge_unknown', since: pushed };
  return { owner: 'them', reason: 'waiting_on_reviewers', since: pushed };
}

/** The viewer's own PR: what they have to fix or finish, else who they wait for. */
function authorTurn(pr: PullRequest, viewer: string): Turn {
  const pushed = pr.lastCommitAt;
  // Only a failure GitHub calls optional (`unstable`) lets a ready PR fall through to its merge.
  if (failingChecksBlock(pr)) return { owner: 'you', reason: 'ci_failed', since: pushed };
  const others = pr.reviews.filter((r) => r.author.toLowerCase() !== viewer);
  // Changes asked after the last push: the author's move. A push since hands it back. A bot's
  // count too: they block the merge like anyone's.
  const asked = others.find((r) => r.state === 'changes_requested' && r.submittedAt > pushed);
  if (asked) return { owner: 'you', reason: 'changes_requested', since: asked.submittedAt };
  if (pr.mergeable === 'conflicting')
    return { owner: 'you', reason: 'conflicts', since: pr.updatedAt };
  const feedback = unansweredFeedback(pr, viewer);
  if (feedback) return { owner: 'you', reason: 'feedback', since: feedback };
  return mergeTurn(pr, others);
}

/** Someone else's PR: a review asked of the viewer, a re-review after a push, or the author's. */
function reviewerTurn(pr: PullRequest, viewer: string, teams: readonly string[]): Turn {
  const pushed = pr.lastCommitAt;
  if (pr.requestedReviewers.some((login) => login.toLowerCase() === viewer))
    return { owner: 'you', reason: 'review_requested', since: later(pr.createdAt, pushed) };
  const mine = pr.reviews.find((r) => r.author.toLowerCase() === viewer);
  if (mine?.state === 'changes_requested' && pushed > mine.submittedAt)
    return { owner: 'you', reason: 're_review', since: pushed };
  if (teams.length > 0)
    return { owner: 'team', reason: 'team_review', since: later(pr.createdAt, pushed) };
  return { owner: 'them', reason: 'waiting_on_author', since: pr.updatedAt };
}

/**
 * Whose turn `pr` is for `viewerLogin`. `teams` are the viewer's teams asked to review it
 * (`snapshot.teamRequests`). Closed PRs and drafts are nobody's turn.
 */
export function whoseTurn(
  pr: PullRequest,
  viewerLogin: string,
  teams: readonly string[] = [],
): Turn {
  if (pr.state !== 'open') return { owner: 'none', reason: 'closed', since: pr.updatedAt };
  if (pr.isDraft) return { owner: 'none', reason: 'draft', since: pr.updatedAt };
  const viewer = viewerLogin.toLowerCase();
  return pr.author?.login.toLowerCase() === viewer
    ? authorTurn(pr, viewer)
    : reviewerTurn(pr, viewer, teams);
}

/** The turn of a PR of `snapshot`, for its viewer and the teams its search found. */
export const turnIn = (snapshot: Snapshot, pr: PullRequest): Turn =>
  whoseTurn(pr, snapshot.viewer.login, snapshot.teamRequests?.[pr.id]);

/**
 * The ids of the PRs of every section where it is the viewer's turn: what the "Your turn"
 * section lists (in the list's sort order, like every section) and the `turn` badge counts.
 */
export function yourTurnIds(snapshot: Snapshot): string[] {
  const ids = new Set(Object.values(snapshot.sections).flat());
  return [...ids]
    .flatMap((id) => snapshot.pullRequests[id] ?? [])
    .filter((pr) => turnIn(snapshot, pr).owner === 'you')
    .map((pr) => pr.id);
}

/** How long a PR may wait on reviewers before the summary calls it stuck. */
export const STUCK_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * The numbers above the "Your turn" list: how many PRs wait on the viewer and since when the
 * oldest has, and how many of the viewer's own PRs have waited on reviewers for over two days
 * (one that is ready and waits only for someone to merge it, `waiting_on_merge`, is not).
 */
export function turnSummary(snapshot: Snapshot, now: number) {
  const ids = new Set(Object.values(snapshot.sections).flat());
  const turns = [...ids]
    .flatMap((id) => snapshot.pullRequests[id] ?? [])
    .map((pr) => turnIn(snapshot, pr));
  const yours = turns.filter((turn) => turn.owner === 'you');
  return {
    waiting: yours.length,
    oldest: yours.map((turn) => turn.since).sort()[0] ?? null,
    stuck: turns.filter(
      (turn) => turn.reason === 'waiting_on_reviewers' && now - Date.parse(turn.since) > STUCK_MS,
    ).length,
  };
}
