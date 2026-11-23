/**
 * Reading a card's detail into `details`. Apart from `prDetail.ts` so that the detail query and
 * its mapper load with the details chunk, not with the list.
 */
import { env } from '../../lib/env';
import { createGitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { fetchPullRequestDetail } from '../../lib/github/fetchPullRequestDetail';
import { t } from '../../lib/i18n';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { type DetailEntry, detailKey, detailOf, details } from './prDetail';
import { auth } from './store';

/** What the detail's merge facts (queue or not, allowed methods, commit titles) depend on. */
export const mergeKey = (pr: PullRequest) =>
  JSON.stringify([pr.headSha, pr.baseRefName, pr.allowedMergeMethods]);

/**
 * The detail merging reads: `detailOf`, else the previous detail while a newer one loads (or
 * failed) for a PR whose head, base and methods are unchanged. A comment or a review moves
 * `updatedAt` but none of the merge facts, so a poll keeps the merge controls, and an open
 * merge dialog, in place instead of hiding them until the reload ends.
 */
export function mergeDetailOf(pr: PullRequest): { detail?: PullRequestDetail; failed: boolean } {
  const known = detailOf(pr);
  const entry = details.value[pr.id];
  if (known.detail || !entry?.detail || entry.mergeKey !== mergeKey(pr)) return known;
  return { detail: entry.detail, failed: false };
}

const put = (id: string, entry: DetailEntry) => {
  details.value = { ...details.value, [id]: entry };
};

/**
 * Fetches the detail of `pr` unless the entry already holds it (or is loading it) for its
 * current `detailKey`; a failed one is tried again. Retains the previous entry in memory while a
 * newer one loads (the view only uses matching completed entries). Publishes only while the
 * loading entry and auth session still belong to this request.
 */
export async function loadDetail(pr: PullRequest): Promise<void> {
  const session = auth.value;
  const token = session?.token;
  const key = detailKey(pr);
  const current = details.value[pr.id];
  if (!token || (current?.key === key && (current.loading || !current.error))) return;
  const kept = { detail: current?.detail, mergeKey: current?.mergeKey };
  const request: DetailEntry = { key, ...kept, loading: true };
  put(pr.id, request);
  const outcome: Partial<DetailEntry> = await fetchPullRequestDetail(
    createGitHubClient({ token, apiUrl: env.apiUrl }),
    pr.id,
    pr,
  ).then(
    (detail) => ({ detail, mergeKey: mergeKey(pr) }),
    (error: unknown) => ({
      error: error instanceof GitHubError ? error.message : t('couldNotLoadTheDetails'),
    }),
  );
  if (auth.value === session && details.value[pr.id] === request) {
    put(pr.id, { key, ...kept, ...outcome, loading: false });
  }
}
