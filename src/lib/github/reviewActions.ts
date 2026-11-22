/**
 * Reviews and comments: what the panel writes as the person on a pull request's conversation.
 * Like every action module (`mergeActions.ts`, `maintenanceActions.ts`), each operation is named
 * (`mutation ProwlApprove`, ...): the E2E mock dispatches on the name, and each call's variables
 * say exactly what is being done. Every function resolves when GitHub confirmed and throws
 * `GitHubError` otherwise (the client masks the token in whatever GitHub answered). Reading the
 * result back is the poller's job.
 */
import { t } from '../i18n';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';

/** GitHub's cap on the body of a review or comment. */
export const MAX_BODY_LENGTH = 65_536;

/**
 * `addPullRequestReview` is one mutation for three outcomes; the name keeps them apart. `$oid`
 * pins the review to the head commit the reviewer looked at, so a push made just before the
 * click is not approved unseen.
 */
const reviewMutation = (name: string) => /* GraphQL */ `
mutation ${name}($id: ID!, $event: PullRequestReviewEvent!, $body: String, $oid: GitObjectID) {
  addPullRequestReview(input: { pullRequestId: $id, event: $event, body: $body, commitOID: $oid }) {
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

interface ReviewData {
  addPullRequestReview: { pullRequestReview: { id: string } | null } | null;
}

interface CommentData {
  addComment: { commentEdge: { node: { id: string } | null } | null } | null;
}

/** The message a person has to write: trimmed, never empty, within GitHub's limit. */
export function messageOf(body: string): string {
  const text = body.trim();
  if (text === '') throw new GitHubError('validation', t('writeAMessageFirst'));
  if (text.length > MAX_BODY_LENGTH) {
    throw new GitHubError('validation', t('theMessageIsLongerThanCharacters', MAX_BODY_LENGTH));
  }
  return text;
}

async function review(
  client: GitHubClient,
  query: string,
  id: string,
  event: 'APPROVE' | 'REQUEST_CHANGES',
  body: string | undefined,
  headSha: string | undefined,
) {
  const data = await client.graphql<ReviewData>(query, { id, event, body, oid: headSha });
  // Strict GraphQL throws on `errors`; a null payload without them still must not read as done.
  if (!data.addPullRequestReview?.pullRequestReview) {
    throw new GitHubError('server', t('githubDidNotConfirmTheReview'));
  }
}

/** Approves the pull request with the node id `prId` at `headSha`, with an optional note. */
export async function approve(
  client: GitHubClient,
  prId: string,
  body?: string,
  headSha?: string,
): Promise<void> {
  await review(client, APPROVE_MUTATION, prId, 'APPROVE', body?.trim() || undefined, headSha);
}

/** Requests changes; GitHub refuses a review of that kind without a message, so does this. */
export async function requestChanges(
  client: GitHubClient,
  prId: string,
  body: string,
  headSha?: string,
): Promise<void> {
  await review(client, REQUEST_CHANGES_MUTATION, prId, 'REQUEST_CHANGES', messageOf(body), headSha);
}

/** Adds a comment to the conversation of the pull request. */
export async function comment(client: GitHubClient, prId: string, body: string): Promise<void> {
  const data = await client.graphql<CommentData>(COMMENT_MUTATION, {
    id: prId,
    body: messageOf(body),
  });
  if (!data.addComment?.commentEdge?.node) {
    throw new GitHubError('server', t('githubDidNotConfirmTheComment'));
  }
}
