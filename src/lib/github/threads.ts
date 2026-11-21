/**
 * Review conversations (threads on the diff) of one pull request: read on demand from an
 * expanded card, replied to and resolved from there. Comments are read as plain text.
 */
import { t } from '../i18n';
import type { ReviewThread } from '../model';
import { messageOf } from './actions';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';

export const THREADS_QUERY = /* GraphQL */ `
query ProwlReviewThreads($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line viewerCanResolve viewerCanReply
          comments(last: 3) { totalCount nodes { author { login } bodyText createdAt url } }
        }
      }
    }
  }
  rateLimit { limit remaining resetAt cost }
}`;

export const RESOLVE_THREAD_MUTATION = /* GraphQL */ `
mutation ProwlResolveThread($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
}`;

export const REPLY_THREAD_MUTATION = /* GraphQL */ `
mutation ProwlReplyThread($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
    comment { id }
  }
}`;

interface ThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  viewerCanResolve: boolean;
  viewerCanReply: boolean;
  comments: {
    totalCount: number;
    nodes:
      | ({
          author: { login: string } | null;
          bodyText: string;
          createdAt: string;
          url: string;
        } | null)[]
      | null;
  };
}
export interface ThreadsData {
  node: { reviewThreads?: { nodes: (ThreadNode | null)[] | null } } | null;
}

/** Maps one thread; exported for tests. */
export function mapThread(node: ThreadNode): ReviewThread {
  const comments = (node.comments.nodes ?? []).flatMap((c) =>
    c
      ? [
          {
            author: c.author?.login ?? 'ghost',
            text: c.bodyText,
            createdAt: c.createdAt,
            url: c.url,
          },
        ]
      : [],
  );
  return {
    id: node.id,
    resolved: node.isResolved,
    outdated: node.isOutdated,
    path: node.path,
    line: node.line,
    canResolve: node.viewerCanResolve,
    canReply: node.viewerCanReply,
    commentCount: node.comments.totalCount,
    comments,
  };
}

/** The unresolved conversations of pull request `id`, current ones before outdated ones. */
export async function fetchReviewThreads(
  client: GitHubClient,
  id: string,
): Promise<ReviewThread[]> {
  const { node } = await client.graphql<ThreadsData>(THREADS_QUERY, { id }, { partial: true });
  if (!node?.reviewThreads) throw new GitHubError('not_found', t('thisPullRequestIsNotAvailable'));
  return (node.reviewThreads.nodes ?? [])
    .flatMap((thread) => (thread && !thread.isResolved ? [mapThread(thread)] : []))
    .sort((a, b) => Number(a.outdated) - Number(b.outdated));
}

/** Marks the conversation resolved. */
export async function resolveThread(client: GitHubClient, threadId: string): Promise<void> {
  const data = await client.graphql<{
    resolveReviewThread: { thread: { isResolved: boolean } | null } | null;
  }>(RESOLVE_THREAD_MUTATION, { id: threadId });
  if (!data.resolveReviewThread?.thread?.isResolved)
    throw new GitHubError('server', t('githubDidNotConfirmTheComment'));
}

/** Replies in the conversation, as the signed-in user. */
export async function replyToThread(
  client: GitHubClient,
  threadId: string,
  body: string,
): Promise<void> {
  const data = await client.graphql<{
    addPullRequestReviewThreadReply: { comment: { id: string } | null } | null;
  }>(REPLY_THREAD_MUTATION, { id: threadId, body: messageOf(body) });
  if (!data.addPullRequestReviewThreadReply?.comment)
    throw new GitHubError('server', t('githubDidNotConfirmTheComment'));
}
