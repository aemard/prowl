import type { PullRequest, Snapshot } from '../../lib/model';

export type ActivityKind = 'new' | 'merged' | 'closed' | 'fade';
export interface PullRequestActivity {
  kind: ActivityKind;
  pr: PullRequest;
}

/** Only actual changes: opening a panel or changing search scope is not a new PR. */
export function pullRequestActivity(
  previous: Snapshot | undefined,
  next: Snapshot,
): PullRequestActivity[] {
  if (!previous || previous.viewer.login.toLowerCase() !== next.viewer.login.toLowerCase())
    return [];
  const changes: PullRequestActivity[] = [];
  for (const pr of Object.values(next.pullRequests)) {
    const before = previous.pullRequests[pr.id];
    if (
      !before &&
      pr.state === 'open' &&
      Date.parse(pr.createdAt) > Date.parse(previous.fetchedAt)
    ) {
      changes.push({ kind: 'new', pr });
    } else if (before?.state === 'open' && (pr.state === 'merged' || pr.state === 'closed')) {
      changes.push({ kind: pr.state, pr });
    }
  }
  return changes;
}
