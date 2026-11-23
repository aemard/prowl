/**
 * `ProwlPullRequestDetail`, the read behind an expanded card, and its shapes. Panel only: kept
 * apart from the polled queries so the service worker does not ship it.
 */
import type { GraphQLRateLimit, Login, Nodes } from './queries';
import { RATE_LIMIT_FIELDS } from './rateLimit';

/**
 * What the expanded card needs about one PR: its head commit's check runs and status contexts
 * (100 per page, `$after` pages through more), who reviewed or was asked to, and the base
 * branch's rules. `isRequired(pullRequestId:)` says which checks block the merge. Teams are left
 * out of the requested reviewers like in `ProwlSearch` (`read:org`). Not polled: one request per
 * page when a card is expanded (cost: docs/architecture.md, "Query cost").
 */
export const DETAIL_QUERY = /* GraphQL */ `
query ProwlPullRequestDetail($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequest {
      latestReviews(first: 20) { totalCount pageInfo { hasNextPage } nodes { state author { login avatarUrl(size: 64) } } }
      reviewRequests(first: 20) {
        totalCount pageInfo { hasNextPage }
        nodes {
          requestedReviewer {
            ... on User { login avatarUrl(size: 64) }
            ... on Bot { login avatarUrl(size: 64) }
            ... on Mannequin { login avatarUrl(size: 64) }
          }
        }
      }
      baseRef { branchProtectionRule { requiredApprovingReviewCount requiresConversationResolution } }
      isMergeQueueEnabled
      mergeQueueEntry { position state estimatedTimeToMerge }
      number title headRefName headRepositoryOwner { login }
      repository { squashMergeCommitTitle mergeCommitTitle }
      firstCommit: commits(first: 1) { totalCount nodes { commit { messageHeadline } } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100, after: $after) {
                totalCount
                pageInfo { hasNextPage endCursor }
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl url isRequired(pullRequestId: $id) }
                  ... on StatusContext { context state targetUrl isRequired(pullRequestId: $id) }
                }
              }
            }
            deployments(last: 5) { nodes { latestEnvironment latestStatus { state environmentUrl } } }
          }
        }
      }
    }
  }
  ${RATE_LIMIT_FIELDS}
}`;

export interface CheckRunNode {
  __typename: 'CheckRun';
  name: string;
  /** `CheckStatusState`; `COMPLETED` means `conclusion` is set. */
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  /** The check run's page on GitHub (absent in older fixtures). */
  url?: string | null;
  isRequired: boolean | null;
}

export interface StatusContextNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  isRequired: boolean | null;
}

export interface DetailPullRequestNode {
  latestReviews: Nodes<{
    state: string;
    author: (Login & { avatarUrl: string }) | null;
  }> | null;
  /** `{}` for a team (not selected, see `DETAIL_QUERY`). */
  reviewRequests: Nodes<{
    requestedReviewer: Partial<Login & { avatarUrl: string }> | null;
  }> | null;
  /** What GitHub titles the merge commit with (absent in older fixtures). */
  number?: number;
  title?: string;
  headRefName?: string;
  headRepositoryOwner?: Login | null;
  repository?: { squashMergeCommitTitle: string; mergeCommitTitle: string };
  firstCommit?: {
    totalCount: number;
    nodes: ({ commit: { messageHeadline: string } } | null)[] | null;
  };
  /** The base branch merges through a queue; absent in older fixtures. */
  isMergeQueueEnabled?: boolean;
  mergeQueueEntry?: { position: number; state: string; estimatedTimeToMerge: number | null } | null;
  /** Null for a base branch without a rule, or when the token cannot see rules. */
  baseRef: {
    branchProtectionRule: {
      requiredApprovingReviewCount: number | null;
      requiresConversationResolution: boolean;
    } | null;
  } | null;
  commits: Nodes<{
    commit: {
      statusCheckRollup: {
        contexts: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          /** Null where a read failed (e.g. a token without access to check runs). */
          nodes: (CheckRunNode | StatusContextNode | null)[] | null;
        };
      } | null;
      /** Absent in older fixtures. */
      deployments?: Nodes<{
        latestEnvironment: string | null;
        latestStatus: { state: string; environmentUrl: string | null } | null;
      }>;
    };
  }>;
}

export interface DetailData {
  /** `{}` when the id is not a pull request, null when it is gone or hidden. */
  node: DetailPullRequestNode | Record<string, never> | null;
  rateLimit: GraphQLRateLimit | null;
}
