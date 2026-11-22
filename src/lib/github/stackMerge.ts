/**
 * Merging the bottom of a GitHub stack. Only GitHub's asynchronous merge API merges stacked pull
 * requests: asked to merge one, it merges it with every open pull request below it, atomically,
 * or adds them all to the merge queue. Prowl asks for the top of the ready part, pinned to the
 * head the user saw, then follows the operation until GitHub says how it ended. Both endpoints
 * are documented under REST version 2026-03-10 only, so they ask for it.
 */
import { t } from '../i18n';
import type { MergeMethod, PullRequest } from '../model';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';

interface MergeAsync {
  status?: 'pending' | 'merged' | 'enqueued' | 'failed';
  details?: { uuid?: string; message?: string };
  message?: string;
}

export interface StackMergeOptions {
  method: MergeMethod;
  /** Add to the merge queue instead of merging now. */
  queue: boolean;
}

/** How a stack merge ended: done, queued, or still running when Prowl stopped waiting. */
export type StackMergeOutcome = 'merged' | 'enqueued' | 'pending';

/** The REST version that documents `merge-async`. */
export const MERGE_ASYNC_VERSION = '2026-03-10';
/** 409: a merge request is already pending for this pull request; the body names it. */
const ALREADY_PENDING = 409;
const POLLS = 30;
const POLL_MS = 2_000;

/**
 * Merges `top` and every open pull request below it in its stack (or queues them). GitHub
 * answers 202 with a pending operation, 200 when the pull request is already merged or queued,
 * and 409 with the operation already pending (asked twice, from another tab or device), which
 * Prowl follows like its own. Throws `GitHubError` when GitHub refuses or reports a failure (a
 * rule, a conflict).
 */
export async function mergeStackUpTo(
  client: GitHubClient,
  top: Pick<PullRequest, 'repo' | 'number' | 'headSha'>,
  { method, queue }: StackMergeOptions,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<StackMergeOutcome> {
  const path = `/repos/${top.repo.nameWithOwner}/pulls/${top.number}/merge-async`;
  const body = queue
    ? { sha: top.headSha, merge_action: 'merge_queue' }
    : { sha: top.headSha, merge_action: 'direct_merge', merge_method: method };
  const options = { apiVersion: MERGE_ASYNC_VERSION };
  const started = await client.restResponse<MergeAsync | undefined>('PUT', path, body, {
    ...options,
    accept: [ALREADY_PENDING],
  });
  let answer = started.data;
  const uuid = answer?.details?.uuid;
  if (started.status === ALREADY_PENDING) {
    if (!uuid)
      throw new GitHubError('validation', answer?.message || t('githubDidNotConfirmTheMerge'));
    answer = { ...answer, status: 'pending' };
  }
  for (let poll = 0; answer?.status === 'pending'; poll++) {
    if (!uuid || poll === POLLS) return 'pending';
    await sleep(POLL_MS);
    answer = await client.rest<MergeAsync>(
      'GET',
      `${path}/${encodeURIComponent(uuid)}`,
      undefined,
      options,
    );
  }
  if (answer?.status === 'merged' || answer?.status === 'enqueued') return answer.status;
  throw new GitHubError(
    'validation',
    answer?.details?.message || answer?.message || t('githubDidNotConfirmTheMerge'),
  );
}
