/**
 * Review conversations (threads on the diff) of one pull request: read on demand from an
 * expanded card, replied to and resolved from there. Comments are read as plain text.
 */
import { t } from '../i18n';
import type { ReviewThread } from '../model';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';
import { messageOf } from './reviewActions';

export const THREADS_QUERY = /* GraphQL */ `
query ProwlReviewThreads($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequest {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
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
  node: {
    reviewThreads?: {
      pageInfo?: { hasNextPage: boolean; endCursor: string | null };
      nodes: (ThreadNode | null)[] | null;
    };
  } | null;
}

/** Pages of 100 threads read at most: resolved ones fill them too, so open ones can be further. */
const MAX_PAGES = 5;

/** The open conversations Prowl read, and whether those are all of them. */
export interface OpenThreads {
  threads: ReviewThread[];
  /** False when GitHub has more threads than `MAX_PAGES` pages: some may be open. */
  complete: boolean;
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

/**
 * The unresolved conversations of pull request `id`, current ones before outdated ones, read page
 * by page (GitHub lists resolved threads too, oldest first) up to `MAX_PAGES`.
 */
export async function fetchReviewThreads(client: GitHubClient, id: string): Promise<OpenThreads> {
  const threads: ReviewThread[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: ThreadsData = await client.graphql<ThreadsData>(
      THREADS_QUERY,
      { id, after },
      { partial: true },
    );
    const list = data.node?.reviewThreads;
    if (!list) throw new GitHubError('not_found', t('thisPullRequestIsNotAvailable'));
    for (const thread of list.nodes ?? [])
      if (thread && !thread.isResolved) threads.push(mapThread(thread));
    after = list.pageInfo?.hasNextPage ? list.pageInfo.endCursor : null;
    if (!after) break;
  }
  threads.sort((a, b) => Number(a.outdated) - Number(b.outdated));
  return { threads, complete: after === null };
}

/** Marks the conversation resolved. */
export async function resolveThread(client: GitHubClient, threadId: string): Promise<void> {
  const data = await client.graphql<{
    resolveReviewThread: { thread: { isResolved: boolean } | null } | null;
  }>(RESOLVE_THREAD_MUTATION, { id: threadId });
  if (!data.resolveReviewThread?.thread?.isResolved)
    throw new GitHubError('server', t('githubDidNotConfirmTheResolve'));
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
