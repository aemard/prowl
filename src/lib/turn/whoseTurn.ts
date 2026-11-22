/**
 * Whose move a pull request waits for: the viewer's, a team's, someone else's, or nobody's, and
 * why. Pure, from the snapshot alone (no extra GitHub read): the list's "Your turn" section, the
 * card's turn chip, the `turn` badge and the `your_turn` notification all read it.
 */
import { isReadyToMerge } from '../diff/diffSnapshots';
import type { MessageKey } from '../i18n';
import type { PullRequest, Snapshot, Turn, TurnReason } from '../model';

/** The short words for each reason it is the viewer's move: card chip and badge tooltip. */
export const TURN_LABELS: Partial<Record<TurnReason, MessageKey>> = {
  review_requested: 'turnReviewRequested',
  re_review: 'turnReReview',
  ci_failed: 'turnCiFailed',
  changes_requested: 'turnChangesRequested',
  conflicts: 'turnConflicts',
  feedback: 'turnFeedback',
  ready_to_merge: 'turnReadyToMerge',
};
const later = (a: string, b: string) => (a > b ? a : b);

/** The viewer's own PR: what they have to fix or finish, else who they wait for. */
function authorTurn(pr: PullRequest, viewer: string): Turn {
  const pushed = pr.lastCommitAt;
  if (pr.checks.state === 'failure') return { owner: 'you', reason: 'ci_failed', since: pushed };
  const others = pr.reviews.filter((r) => r.author.toLowerCase() !== viewer);
  // Changes asked after the last push: the author's move. A push since hands it back. A bot's
  // count too: they block the merge like anyone's.
  const asked = others.find((r) => r.state === 'changes_requested' && r.submittedAt > pushed);
  if (asked) return { owner: 'you', reason: 'changes_requested', since: asked.submittedAt };
  if (pr.mergeable === 'conflicting')
    return { owner: 'you', reason: 'conflicts', since: pr.updatedAt };
  // Bots (Copilot code review, CodeRabbit, CI reports) comment after every push: not feedback.
  const reviewed = others.find(
    (r) => r.state === 'commented' && !r.isBot && r.submittedAt > pushed,
  );
  const comment = pr.lastComment;
  const commented =
    comment &&
    comment.createdAt > pushed &&
    comment.author.toLowerCase() !== viewer &&
    !comment.isBot
      ? comment.createdAt
      : null;
  const feedback = reviewed?.submittedAt ?? commented;
  if (feedback) return { owner: 'you', reason: 'feedback', since: feedback };
  // Auto-merge is on: GitHub merges it now, nobody has to.
  if (isReadyToMerge(pr) && pr.autoMerge)
    return { owner: 'none', reason: 'auto_merge', since: pushed };
  if (isReadyToMerge(pr) && pr.viewerCanMerge) {
    const approved = others.find((r) => r.state === 'approved')?.submittedAt ?? pushed;
    return { owner: 'you', reason: 'ready_to_merge', since: later(approved, pushed) };
  }
  if (pr.checks.state === 'pending')
    return { owner: 'them', reason: 'waiting_on_checks', since: pushed };
  return { owner: 'them', reason: 'waiting_on_reviewers', since: pushed };
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
 * The ids of the PRs of every section where it is the viewer's turn, longest waiting first:
 * what the "Your turn" section lists and the `turn` badge counts.
 */
export function yourTurnIds(snapshot: Snapshot): string[] {
  const ids = new Set(Object.values(snapshot.sections).flat());
  return [...ids]
    .flatMap((id) => snapshot.pullRequests[id] ?? [])
    .map((pr) => ({ pr, turn: turnIn(snapshot, pr) }))
    .filter(({ turn }) => turn.owner === 'you')
    .sort((a, b) => a.turn.since.localeCompare(b.turn.since))
    .map(({ pr }) => pr.id);
}

/** How long a PR may wait on reviewers before the summary calls it stuck. */
export const STUCK_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * The numbers above the "Your turn" list: how many PRs wait on the viewer and since when the
 * oldest has, and how many of the viewer's own PRs have waited on reviewers for over two days.
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
