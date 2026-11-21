/** Review conversations of expanded cards, read on demand and kept until the panel closes. */
import { signal } from '@preact/signals';
import { env } from '../../lib/env';
import { createGitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { fetchReviewThreads } from '../../lib/github/threads';
import { t } from '../../lib/i18n';
import type { PullRequest, ReviewThread } from '../../lib/model';
import { auth } from './store';

export interface ThreadsEntry {
  loading: boolean;
  threads?: ReviewThread[];
  error?: string;
}

/** PR id -> its open conversations. */
export const reviewThreads = signal<Record<string, ThreadsEntry>>({});

/** (Re)reads the open conversations of `pr`; the previous list stays on screen meanwhile. */
export async function loadThreads(pr: PullRequest): Promise<void> {
  const session = auth.value;
  if (!session) return;
  const previous = reviewThreads.value[pr.id];
  const put = (entry: ThreadsEntry) => {
    if (auth.value === session) reviewThreads.value = { ...reviewThreads.value, [pr.id]: entry };
  };
  put({ loading: true, threads: previous?.threads });
  try {
    const client = createGitHubClient({ token: session.token, apiUrl: env.apiUrl });
    put({ loading: false, threads: await fetchReviewThreads(client, pr.id) });
  } catch (error) {
    const reason = error instanceof GitHubError ? error.message : t('somethingWentWrong');
    put({
      loading: false,
      threads: previous?.threads,
      error: t('couldNotLoadConversations', reason),
    });
  }
}
