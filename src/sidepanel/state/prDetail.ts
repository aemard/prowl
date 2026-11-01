/**
 * Expanded cards and their details. Module signals, like the list's tab and filter, so an
 * expanded card stays open across background refreshes, tab switches and a visit to Settings.
 * Details are fetched when a card is expanded (never polled) and kept in memory only.
 */
import { computed, effect, signal } from '@preact/signals';
import { env } from '../../lib/env';
import { createGitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { fetchPullRequestDetail } from '../../lib/github/fetchPullRequestDetail';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { sendToBackground } from './background';
import { auth, snapshot } from './store';

export interface DetailEntry {
  /** What the entry was fetched for (`detailKey`); another key means the PR has changed since. */
  key: string;
  /** The last detail that loaded, kept while a newer one loads or fails. */
  detail?: PullRequestDetail;
  error?: string;
  loading: boolean;
}

/** Ids of the expanded cards. */
export const expandedIds = signal<readonly string[]>([]);
/** PR id -> its detail. */
export const details = signal<Readonly<Record<string, DetailEntry>>>({});

/**
 * Changes with the data the detail reads. Merge facts already update directly from the list;
 * their unknown -> verified transition must not fetch the same checks and reviewers twice.
 */
export const detailKey = (pr: PullRequest) =>
  JSON.stringify([
    pr.headSha,
    pr.baseRefName,
    pr.allowedMergeMethods,
    pr.updatedAt,
    [
      pr.checks.state,
      pr.checks.total,
      pr.checks.passed,
      pr.checks.failed,
      pr.checks.pending,
      pr.checks.neutral,
    ],
    pr.reviews.map((review) => [review.id, review.state, review.submittedAt, review.author]),
    pr.requestedReviewers,
  ]);

export function toggleExpanded(id: string): void {
  const open = expandedIds.value;
  expandedIds.value = open.includes(id) ? open.filter((other) => other !== id) : [...open, id];
  const pr = snapshot.value?.pullRequests[id];
  if (!open.includes(id) && pr) {
    void sendToBackground({ type: 'refreshMergeState', prId: id, headSha: pr.headSha });
  }
}

export function collapse(id: string): void {
  expandedIds.value = expandedIds.value.filter((other) => other !== id);
}

// Another account (or none) must not see what the previous one expanded. The computed only
// changes with the token itself, not with every rewrite of `auth`.
const signedInAs = computed(() => auth.value?.token);
effect(() => {
  void signedInAs.value;
  expandedIds.value = [];
  details.value = {};
});

const put = (id: string, entry: DetailEntry) => {
  details.value = { ...details.value, [id]: entry };
};

/**
 * Fetches the detail of `pr` unless the entry already holds it (or is loading it) for its
 * current `detailKey`; a failed one is tried again. Retains the previous entry in memory while a
 * newer one loads (the view only uses matching completed entries), and drops an answer that a newer request has overtaken.
 */
export async function loadDetail(pr: PullRequest): Promise<void> {
  const token = signedInAs.value;
  const key = detailKey(pr);
  const current = details.value[pr.id];
  if (!token || (current?.key === key && (current.loading || !current.error))) return;
  put(pr.id, { key, detail: current?.detail, loading: true });
  const outcome: Partial<DetailEntry> = await fetchPullRequestDetail(
    createGitHubClient({ token, apiUrl: env.apiUrl }),
    pr.id,
    pr,
  ).then(
    (detail) => ({ detail }),
    (error: unknown) => ({
      error: error instanceof GitHubError ? error.message : 'Could not load the details.',
    }),
  );
  if (details.value[pr.id]?.key === key) {
    put(pr.id, { key, detail: current?.detail, ...outcome, loading: false });
  }
}
