/**
 * Reading a card's detail into `details`. Apart from `prDetail.ts` so that the detail query and
 * its mapper load with the details chunk, not with the list.
 */
import { env } from '../../lib/env';
import { createGitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { fetchPullRequestDetail } from '../../lib/github/fetchPullRequestDetail';
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { type DetailEntry, detailKey, details } from './prDetail';
import { auth } from './store';

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
  const request: DetailEntry = { key, detail: current?.detail, loading: true };
  put(pr.id, request);
  const outcome: Partial<DetailEntry> = await fetchPullRequestDetail(
    createGitHubClient({ token, apiUrl: env.apiUrl }),
    pr.id,
    pr,
  ).then(
    (detail) => ({ detail }),
    (error: unknown) => ({
      error: error instanceof GitHubError ? error.message : t('couldNotLoadTheDetails'),
    }),
  );
  if (auth.value === session && details.value[pr.id] === request) {
    put(pr.id, { key, detail: current?.detail, ...outcome, loading: false });
  }
}
