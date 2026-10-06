/**
 * What the panel changes on GitHub, as named operations (`mutation ProwlApprove`, ...): the E2E
 * mock dispatches on the name, and each call's variables say exactly what is being done. Every
 * function resolves when GitHub confirmed and throws `GitHubError` otherwise (the client masks
 * the token in whatever GitHub answered). Reading the result back is the poller's job.
 */
import type { MergeMethod } from '../model';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';

/** GitHub's cap on the body of a review or comment. */
export const MAX_BODY_LENGTH = 65_536;

/** `addPullRequestReview` is one mutation for three outcomes; the name keeps them apart. */
const reviewMutation = (name: string) => /* GraphQL */ `
mutation ${name}($id: ID!, $event: PullRequestReviewEvent!, $body: String) {
  addPullRequestReview(input: { pullRequestId: $id, event: $event, body: $body }) {
    pullRequestReview { id }
  }
}`;

export const APPROVE_MUTATION = reviewMutation('ProwlApprove');
export const REQUEST_CHANGES_MUTATION = reviewMutation('ProwlRequestChanges');

/** A conversation comment on the PR (the comment box under its description), not a review. */
export const COMMENT_MUTATION = /* GraphQL */ `
mutation ProwlComment($id: ID!, $body: String!) {
  addComment(input: { subjectId: $id, body: $body }) {
    commentEdge { node { id } }
  }
}`;

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

interface ReviewData {
  addPullRequestReview: { pullRequestReview: { id: string } | null } | null;
}

interface MergeData {
  mergePullRequest: { pullRequest: { merged: boolean } | null } | null;
}

interface CommentData {
  addComment: { commentEdge: { node: { id: string } | null } | null } | null;
}

/** The message a person has to write: trimmed, never empty, within GitHub's limit. */
function messageOf(body: string): string {
  const text = body.trim();
  if (text === '') throw new GitHubError('validation', 'Write a message first.');
  if (text.length > MAX_BODY_LENGTH) {
    throw new GitHubError(
      'validation',
      `The message is longer than ${MAX_BODY_LENGTH} characters.`,
    );
  }
  return text;
}

async function review(
  client: GitHubClient,
  query: string,
  id: string,
  event: 'APPROVE' | 'REQUEST_CHANGES',
  body: string | undefined,
) {
  const data = await client.graphql<ReviewData>(query, { id, event, body });
  // Strict GraphQL throws on `errors`; a null payload without them still must not read as done.
  if (!data.addPullRequestReview?.pullRequestReview) {
    throw new GitHubError('server', 'GitHub did not confirm the review.');
  }
}

/** Approves the pull request with the node id `prId`, with an optional note. */
export async function approve(client: GitHubClient, prId: string, body?: string): Promise<void> {
  await review(client, APPROVE_MUTATION, prId, 'APPROVE', body?.trim() || undefined);
}

/** Requests changes; GitHub refuses a review of that kind without a message, so does this. */
export async function requestChanges(
  client: GitHubClient,
  prId: string,
  body: string,
): Promise<void> {
  await review(client, REQUEST_CHANGES_MUTATION, prId, 'REQUEST_CHANGES', messageOf(body));
}

/** Adds a comment to the conversation of the pull request. */
export async function comment(client: GitHubClient, prId: string, body: string): Promise<void> {
  const data = await client.graphql<CommentData>(COMMENT_MUTATION, {
    id: prId,
    body: messageOf(body),
  });
  if (!data.addComment?.commentEdge?.node) {
    throw new GitHubError('server', 'GitHub did not confirm the comment.');
  }
}

export interface MergeOptions {
  method: MergeMethod;
  /** The head commit the person looked at (`PullRequest.headSha`). */
  headSha: string;
  /** Title of the merge or squash commit; GitHub's own when empty. A rebase has none. */
  title?: string;
}

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
    headline: method === 'rebase' ? undefined : title?.trim() || undefined,
  });
  if (!data.mergePullRequest?.pullRequest?.merged) {
    throw new GitHubError('server', 'GitHub did not confirm the merge.');
  }
}
