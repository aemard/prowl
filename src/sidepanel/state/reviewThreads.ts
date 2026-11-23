/**
 * Review conversations of expanded cards, read on demand and kept until the panel closes, the
 * account changes, or the pull request does (`threadsStale`).
 */
import { signal } from '@preact/signals';
import { env } from '../../lib/env';
import { createGitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { fetchReviewThreads } from '../../lib/github/threads';
import { t } from '../../lib/i18n';
import type { PullRequest, ReviewThread } from '../../lib/model';
import { auth, onAccountChange } from './store';

export interface ThreadsEntry {
  /**
   * The PR's `updatedAt` the entry was read for: GitHub's at the time of the read, which is
   * already past a reply or resolve made from the panel, else the panel's when it asked.
   */
  key: string;
  loading: boolean;
  threads?: ReviewThread[];
  /** False when GitHub has more conversations than Prowl reads: some open ones are only there. */
  complete?: boolean;
  error?: string;
}

/** PR id -> its open conversations. */
export const reviewThreads = signal<Record<string, ThreadsEntry>>({});

onAccountChange(() => {
  reviewThreads.value = {};
});

/**
 * (Re)reads the open conversations of `pr`; the previous list stays on screen meanwhile. Only the
 * latest request publishes, and only for the session it started in.
 */
export async function loadThreads(pr: PullRequest): Promise<void> {
  const session = auth.value;
  if (!session) return;
  const previous = reviewThreads.value[pr.id];
  const request: ThreadsEntry = {
    key: pr.updatedAt,
    loading: true,
    threads: previous?.threads,
    complete: previous?.complete,
  };
  reviewThreads.value = { ...reviewThreads.value, [pr.id]: request };
  const put = (entry: Omit<ThreadsEntry, 'key' | 'loading'> & { key?: string }) => {
    if (auth.value !== session || reviewThreads.value[pr.id] !== request) return;
    reviewThreads.value = {
      ...reviewThreads.value,
      [pr.id]: { key: request.key, loading: false, ...entry },
    };
  };
  try {
    const client = createGitHubClient({ token: session.token, apiUrl: env.apiUrl });
    const { updatedAt = request.key, ...read } = await fetchReviewThreads(client, pr.id);
    put({ ...read, key: updatedAt });
  } catch (error) {
    const reason = error instanceof GitHubError ? error.message : t('somethingWentWrong');
    put({
      threads: previous?.threads,
      complete: previous?.complete,
      error: t('couldNotLoadConversations', reason),
    });
  }
}

/**
 * Whether `entry` predates what the panel now knows of `pr`: a poll brought a newer `updatedAt`
 * than the read. The one a reply or resolve from the panel moved is not newer than the read
 * that followed it, so the conversations are not read twice.
 */
export const threadsStale = (entry: ThreadsEntry | undefined, pr: PullRequest) =>
  entry !== undefined && !entry.loading && entry.key < pr.updatedAt;
