/**
 * Review conversations of expanded cards, read on demand and kept until the panel closes, the
 * account changes, or the pull request does (its `updatedAt`, which a reply or a resolve moves).
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
  /** The PR's `updatedAt` the entry was read (or is being read) for. */
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
  const put = (entry: Omit<ThreadsEntry, 'key' | 'loading'>) => {
    if (auth.value !== session || reviewThreads.value[pr.id] !== request) return;
    reviewThreads.value = {
      ...reviewThreads.value,
      [pr.id]: { key: request.key, loading: false, ...entry },
    };
  };
  try {
    const client = createGitHubClient({ token: session.token, apiUrl: env.apiUrl });
    put(await fetchReviewThreads(client, pr.id));
  } catch (error) {
    const reason = error instanceof GitHubError ? error.message : t('somethingWentWrong');
    put({
      threads: previous?.threads,
      complete: previous?.complete,
      error: t('couldNotLoadConversations', reason),
    });
  }
}
