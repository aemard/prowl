/**
 * GraphQL reads of the poller and the response shapes they return. Every operation is named:
 * the E2E mock dispatches on the name. Enum values are typed as `string` because GitHub adds
 * values over time; `mapPullRequest.ts` maps unknown ones to safe defaults.
 *
 * Estimated cost (GitHub: requests needed for every connection / 100, rounded): a search page
 * of 50 PRs with its 7 nested connections is 1 + 50 x 7 = 351 requests, about 4 points;
 * `ProwlNodes` with 100 ids is 1 point. Lists use counts (`checkRunCountsByState`) instead of
 * check nodes, so the page stays light whatever the number of checks.
 */

const RATE_LIMIT = 'rateLimit { limit remaining resetAt cost }';

/**
 * One page of a section's search. Team reviewers are left out on purpose: every `Team` field
 * needs the `read:org` scope, and selecting one fails the whole query for a `repo`-only token.
 */
export const SEARCH_QUERY = /* GraphQL */ `
query ProwlSearch($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id
        number
        title
        url
        state
        isDraft
        headRefName
        baseRefName
        headRefOid
        createdAt
        updatedAt
        author { login avatarUrl(size: 64) }
        mergedBy { login }
        repository {
          name
          nameWithOwner
          owner { login }
          mergeCommitAllowed
          squashMergeAllowed
          rebaseMergeAllowed
        }
        reviewDecision
        mergeable
        mergeStateStatus
        viewerCanUpdate
        totalCommentsCount
        labels(first: 20) { nodes { name color } }
        latestReviews(first: 20) { nodes { id state submittedAt author { login } } }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              ... on User { login }
              ... on Bot { login }
              ... on Mannequin { login }
            }
          }
        }
        reviewThreads(first: 100) { nodes { isResolved } }
        comments(last: 1) { nodes { createdAt author { login } } }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts {
                  checkRunCountsByState { state count }
                  statusContextCountsByState { state count }
                }
              }
            }
          }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`;

/** Final state of PRs that left every section: merged or closed, and by whom. */
export const NODES_QUERY = /* GraphQL */ `
query ProwlNodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest {
      id
      state
      merged
      updatedAt
      mergedBy { login }
      timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) {
        nodes { ... on ClosedEvent { actor { login } } }
      }
    }
  }
  ${RATE_LIMIT}
}`;

/**
 * What the expanded card needs about one PR: its head commit's check runs and status contexts
 * (100 per page, `$after` pages through more), who reviewed or was asked to, and the base
 * branch's rules. `isRequired(pullRequestId:)` says which checks block the merge. Teams are left
 * out of the requested reviewers like in `ProwlSearch` (`read:org`). Not polled: one request per
 * page when a card is expanded, about 1 point (1 + 4 connections = 5 requests).
 */
export const DETAIL_QUERY = /* GraphQL */ `
query ProwlPullRequestDetail($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequest {
      latestReviews(first: 20) { nodes { state author { login avatarUrl(size: 64) } } }
      reviewRequests(first: 20) {
        nodes {
          requestedReviewer {
            ... on User { login avatarUrl(size: 64) }
            ... on Bot { login avatarUrl(size: 64) }
            ... on Mannequin { login avatarUrl(size: 64) }
          }
        }
      }
      baseRef { branchProtectionRule { requiredApprovingReviewCount requiresConversationResolution } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100, after: $after) {
                totalCount
                pageInfo { hasNextPage endCursor }
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestId: $id) }
                  ... on StatusContext { context state targetUrl isRequired(pullRequestId: $id) }
                }
              }
            }
          }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`;

/** A connection as selected here: only `nodes`, whose entries are null where a read failed. */
export interface Nodes<T> {
  nodes: (T | null)[] | null;
}

interface Login {
  login: string;
}

export interface StateCount {
  state: string;
  count: number;
}

export interface PullRequestNode {
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  createdAt: string;
  updatedAt: string;
  author: (Login & { avatarUrl: string }) | null;
  mergedBy: Login | null;
  repository: {
    name: string;
    nameWithOwner: string;
    owner: Login;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
  };
  reviewDecision: string | null;
  mergeable: string;
  mergeStateStatus: string;
  viewerCanUpdate: boolean;
  totalCommentsCount: number | null;
  labels: Nodes<{ name: string; color: string }> | null;
  latestReviews: Nodes<{
    id: string;
    state: string;
    submittedAt: string | null;
    author: Login | null;
  }> | null;
  /** `{}` for a team (not selected, see `SEARCH_QUERY`). */
  reviewRequests: Nodes<{ requestedReviewer: Partial<Login> | null }> | null;
  reviewThreads: Nodes<{ isResolved: boolean }>;
  comments: Nodes<{ createdAt: string; author: Login | null }>;
  commits: Nodes<{
    commit: {
      statusCheckRollup: {
        contexts: {
          checkRunCountsByState: StateCount[] | null;
          statusContextCountsByState: StateCount[] | null;
        };
      } | null;
    };
  }>;
}

export interface GraphQLRateLimit {
  limit: number;
  remaining: number;
  resetAt: string;
  cost: number;
}

export interface SearchData {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    /** Null where a read failed (an org that requires SAML); `{}` for a non-PR result. */
    nodes: (PullRequestNode | Record<string, never> | null)[] | null;
  };
  rateLimit: GraphQLRateLimit | null;
}

export interface ClosedPullRequestNode {
  id: string;
  state: string;
  merged: boolean;
  updatedAt: string;
  mergedBy: Login | null;
  timelineItems: Nodes<{ actor: Login | null }>;
}

export interface NodesData {
  /** Same order as the ids; null for a deleted or inaccessible PR. */
  nodes: (ClosedPullRequestNode | Record<string, never> | null)[];
  rateLimit: GraphQLRateLimit | null;
}

export interface CheckRunNode {
  __typename: 'CheckRun';
  name: string;
  /** `CheckStatusState`; `COMPLETED` means `conclusion` is set. */
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  isRequired: boolean;
}

export interface StatusContextNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  isRequired: boolean;
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
    };
  }>;
}

export interface DetailData {
  /** `{}` when the id is not a pull request, null when it is gone or hidden. */
  node: DetailPullRequestNode | Record<string, never> | null;
  rateLimit: GraphQLRateLimit | null;
}
