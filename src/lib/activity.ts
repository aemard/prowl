import type { PullRequest } from './model';

/** Useful observed activity, excluding polling dates and transient merge enrichment. */
export function activityKey(pr: PullRequest): string {
  return JSON.stringify([
    pr.updatedAt,
    pr.headSha,
    pr.title,
    pr.state,
    pr.isDraft,
    [
      pr.checks.state,
      pr.checks.total,
      pr.checks.passed,
      pr.checks.failed,
      pr.checks.pending,
      pr.checks.neutral,
    ],
    pr.reviews
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, state }) => [id, state]),
    pr.requestedReviewers.slice().sort(),
    pr.commentCount,
    pr.lastComment?.createdAt,
    pr.unresolvedThreads,
    pr.autoMerge?.method ?? null,
  ]);
}
