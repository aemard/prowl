/**
 * Merging: now, when the requirements pass (auto-merge) or through the merge queue. Every write
 * is pinned to the head the person looked at (`expectedHeadOid`), so commits nobody saw are never
 * merged. Conventions as in `reviewActions.ts`; stacks merge through `stackMerge.ts`.
 */
import { t } from '../i18n';
import type { MergeMethod } from '../model';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';

/**
 * `$oid` is required: GitHub refuses the merge when the head moved since the panel looked
 * ("Head branch was modified"), so commits nobody saw are never merged.
 */
export const MERGE_MUTATION = /* GraphQL */ `
mutation ProwlMerge($id: ID!, $method: PullRequestMergeMethod!, $oid: GitObjectID!, $headline: String) {
  mergePullRequest(
    input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $oid, commitHeadline: $headline }
  ) {
    pullRequest { merged }
  }
}`;

interface MergeData {
  mergePullRequest: { pullRequest: { merged: boolean } | null } | null;
}

export interface MergeOptions {
  method: MergeMethod;
  /** The head commit the person looked at (`PullRequest.headSha`). */
  headSha: string;
  /** Title of the merge or squash commit; GitHub's own when empty. A rebase has none. */
  title?: string;
}

/** The commit title to send: none for a rebase (it writes no commit), GitHub's own when blank. */
const headlineOf = (method: MergeMethod, title: string | undefined) =>
  method === 'rebase' ? undefined : title?.trim() || undefined;

/** Merges the pull request, unless its head is no longer `headSha`. */
export async function mergePullRequest(
  client: GitHubClient,
  prId: string,
  { method, headSha, title }: MergeOptions,
): Promise<void> {
  const data = await client.graphql<MergeData>(MERGE_MUTATION, {
    id: prId,
    method: method.toUpperCase(),
    oid: headSha,
    headline: headlineOf(method, title),
  });
  if (!data.mergePullRequest?.pullRequest?.merged) {
    throw new GitHubError('server', t('githubDidNotConfirmTheMerge'));
  }
}

export const ENABLE_AUTO_MERGE_MUTATION = /* GraphQL */ `
mutation ProwlEnableAutoMerge($id: ID!, $method: PullRequestMergeMethod!, $oid: GitObjectID!, $headline: String) {
  enablePullRequestAutoMerge(
    input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $oid, commitHeadline: $headline }
  ) {
    pullRequest { autoMergeRequest { mergeMethod } }
  }
}`;

export const DISABLE_AUTO_MERGE_MUTATION = /* GraphQL */ `
mutation ProwlDisableAutoMerge($id: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
    pullRequest { autoMergeRequest { mergeMethod } }
  }
}`;

type AutoMergePayload = { pullRequest: { autoMergeRequest: object | null } | null } | null;

/**
 * Turns auto-merge on with `method` (GitHub merges once the requirements pass, unless the head
 * moved from `headSha`; `title` as for `mergePullRequest`), or off when `method` is null.
 */
export async function setAutoMerge(
  client: GitHubClient,
  prId: string,
  method: MergeMethod | null,
  headSha: string,
  title?: string,
): Promise<void> {
  const data = await client.graphql<{
    enablePullRequestAutoMerge?: AutoMergePayload;
    disablePullRequestAutoMerge?: AutoMergePayload;
  }>(
    method ? ENABLE_AUTO_MERGE_MUTATION : DISABLE_AUTO_MERGE_MUTATION,
    method
      ? {
          id: prId,
          method: method.toUpperCase(),
          oid: headSha,
          headline: headlineOf(method, title),
        }
      : { id: prId },
  );
  const payload = method ? data.enablePullRequestAutoMerge : data.disablePullRequestAutoMerge;
  if (
    !payload?.pullRequest ||
    (payload.pullRequest.autoMergeRequest !== null) !== (method !== null)
  ) {
    throw new GitHubError('server', t('githubDidNotConfirmChange'));
  }
}

/** Adds the pull request to its base branch's merge queue, pinned to the head the user saw. */
export const ENQUEUE_MUTATION = /* GraphQL */ `
mutation ProwlEnqueue($id: ID!, $oid: GitObjectID!) {
  enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $oid }) {
    mergeQueueEntry { position }
  }
}`;

export const DEQUEUE_MUTATION = /* GraphQL */ `
mutation ProwlDequeue($id: ID!) {
  dequeuePullRequest(input: { id: $id }) { mergeQueueEntry { id } }
}`;

/** Queues the pull request for merging, unless its head is no longer `headSha`. */
export async function enqueuePullRequest(
  client: GitHubClient,
  prId: string,
  headSha: string,
): Promise<void> {
  const data = await client.graphql<{
    enqueuePullRequest: { mergeQueueEntry: { position: number } | null } | null;
  }>(ENQUEUE_MUTATION, { id: prId, oid: headSha });
  if (!data.enqueuePullRequest?.mergeQueueEntry)
    throw new GitHubError('server', t('githubDidNotConfirmTheMerge'));
}

/** Takes the pull request out of the merge queue. */
export async function dequeuePullRequest(client: GitHubClient, prId: string): Promise<void> {
  const data = await client.graphql<{ dequeuePullRequest: unknown }>(DEQUEUE_MUTATION, {
    id: prId,
  });
  if (!data.dequeuePullRequest) throw new GitHubError('server', t('githubDidNotConfirmTheMerge'));
}
