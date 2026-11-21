/**
 * Stacked pull requests: a PR whose base branch is another open PR's head branch, in the same
 * repository, sits on top of it and merges after it. Pure; from the snapshot alone.
 */
import type { PullRequest, Snapshot } from './model';

/** The open PR of `snapshot` that `pr` is stacked on, if any. */
export function stackedOn(snapshot: Snapshot, pr: PullRequest): PullRequest | undefined {
  if (pr.state !== 'open') return undefined;
  return Object.values(snapshot.pullRequests).find(
    (other) =>
      other.id !== pr.id &&
      other.state === 'open' &&
      other.repo.nameWithOwner === pr.repo.nameWithOwner &&
      other.headRefName === pr.baseRefName,
  );
}
