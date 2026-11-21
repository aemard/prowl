/**
 * Whose move a pull request waits for: the viewer's, a team's, someone else's, or nobody's, and
 * why. Pure, from the snapshot alone (no extra GitHub read): the list's "Your turn" section, the
 * card's turn chip, the `turn` badge and the `your_turn` notification all read it.
 */
import { isReadyToMerge } from '../diff/diffSnapshots';
import type { MessageKey } from '../i18n';
import type { PullRequest, Snapshot, Turn, TurnReason } from '../model';

/**
 * ponytail: GraphQL drops the `[bot]` suffix, so app accounts are recognized by name; a human
 * whose login ends in "bot" is taken for one, which only means their comment does not ask you.
 */
const BOT_LOGIN = /(?:\[bot\]|bot|^github-actions)$/i;

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
  // Changes asked after the last push: the author's move. A push since hands it back.
  const asked = others.find((r) => r.state === 'changes_requested' && r.submittedAt > pushed);
  if (asked) return { owner: 'you', reason: 'changes_requested', since: asked.submittedAt };
  if (pr.mergeable === 'conflicting')
    return { owner: 'you', reason: 'conflicts', since: pr.updatedAt };
  const reviewed = others.find((r) => r.state === 'commented' && r.submittedAt > pushed);
  const comment = pr.lastComment;
  const commented =
    comment &&
    comment.createdAt > pushed &&
    comment.author.toLowerCase() !== viewer &&
    !BOT_LOGIN.test(comment.author)
      ? comment.createdAt
      : null;
  const feedback = reviewed?.submittedAt ?? commented;
  if (feedback) return { owner: 'you', reason: 'feedback', since: feedback };
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
