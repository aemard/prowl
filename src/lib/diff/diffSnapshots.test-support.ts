/** Builders shared by the diff engine tests. */
import { prNode, viewerNode } from '../../../tests/fixtures/github';
import { mapPullRequest } from '../github/mapPullRequest';
import type { CheckState, PullRequest, Review, Snapshot } from '../model';

export const VIEWER = 'octocat';
export const FETCHED_AT = '2026-10-06T09:00:00.000Z';
export const YESTERDAY = '2026-10-05T08:00:00Z';
export const REVIEWED = '2026-10-06T08:00:00Z';
export const COMMENTED = '2026-10-06T08:30:00Z';
export const CLOSED = '2026-10-06T08:45:00Z';
export const SHA = 'a'.repeat(40);
export const NEW_SHA = 'b'.repeat(40);

/** Open, checks passing, review required, mergeable but `blocked`: not ready to merge. */
export const base = mapPullRequest(prNode());
export const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  ...base,
  ...overrides,
});
export const ci = (state: CheckState, headSha = SHA): Partial<PullRequest> => ({
  checks: { ...base.checks, state },
  headSha,
});
export const review = (author: string, state: Review['state'], submittedAt = REVIEWED): Review => ({
  id: `PRR_${author}_${state}`,
  author,
  state,
  submittedAt,
});
export const reviews = (...list: Review[]) => ({ reviews: list });
export const comments = (commentCount: number, author?: string, createdAt = COMMENTED) => ({
  commentCount,
  lastComment: author ? { author, createdAt } : null,
});
export const ready = (overrides: Partial<PullRequest> = {}): Partial<PullRequest> => ({
  mergeStateStatus: 'clean',
  ...overrides,
});
export const ended = (
  state: 'merged' | 'closed',
  closedBy: string | null,
): Partial<PullRequest> => ({
  state,
  closedBy,
  updatedAt: CLOSED,
});

export function snapshot(prs: PullRequest[], fetchedAt = FETCHED_AT, login = VIEWER): Snapshot {
  return {
    fetchedAt,
    viewer: viewerNode({ login }),
    pullRequests: Object.fromEntries(prs.map((p) => [p.id, p])),
    sections: { authored: prs.map(({ id }) => id) },
  };
}
