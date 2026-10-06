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

/**
 * The check suites of the head commit, to find what failed. Each suite is either a GitHub
 * Actions workflow run (re-run only its failed jobs) or another app's suite (ask it to run again).
 */
export const FAILED_SUITES_QUERY = /* GraphQL */ `
query ProwlFailedSuites($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      repository { owner { login } name }
      commits(last: 1) {
        nodes {
          commit {
            checkSuites(first: 50) {
              nodes { databaseId conclusion workflowRun { databaseId } }
            }
          }
        }
      }
    }
  }
}`;

interface FailedSuitesData {
  node: {
    repository?: { owner: { login: string }; name: string };
    commits?: {
      nodes: Array<{
        commit: {
          checkSuites: {
            nodes: Array<{
              databaseId: number;
              conclusion: string | null;
              workflowRun: { databaseId: number } | null;
            } | null>;
          } | null;
        };
      } | null>;
    };
  } | null;
}

/** Suite conclusions worth a re-run. Cancelled and skipped suites are left alone. */
const RERUNNABLE = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE']);

/**
 * Re-runs what failed on the head commit: the failed jobs of each failed Actions run
 * (`rerun-failed-jobs`), and every other failed suite (`rerequest`). Resolves to the number of
 * runs and suites restarted. When some restarts fail, it throws with how many worked.
 */
export async function rerunFailedChecks(client: GitHubClient, prId: string): Promise<number> {
  const { node } = await client.graphql<FailedSuitesData>(FAILED_SUITES_QUERY, { id: prId });
  if (!node?.repository)
    throw new GitHubError('not_found', 'GitHub did not find the pull request.');
  const repo = `/repos/${encodeURIComponent(node.repository.owner.login)}/${encodeURIComponent(node.repository.name)}`;
  const suites = node.commits?.nodes[0]?.commit.checkSuites?.nodes ?? [];
  const paths = new Set<string>();
  for (const suite of suites) {
    if (!suite || !RERUNNABLE.has(suite.conclusion ?? '')) continue;
    paths.add(
      suite.workflowRun
        ? `${repo}/actions/runs/${suite.workflowRun.databaseId}/rerun-failed-jobs`
        : `${repo}/check-suites/${suite.databaseId}/rerequest`,
    );
  }
  if (paths.size === 0) throw new GitHubError('validation', 'No failed checks to re-run.');

  const results = await Promise.allSettled([...paths].map((path) => client.rest('POST', path)));
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    const reason =
      failure.reason instanceof GitHubError
        ? failure.reason
        : new GitHubError('server', 'Something went wrong.');
    const worked = results.length - results.filter((r) => r.status === 'rejected').length;
    throw worked === 0
      ? reason
      : new GitHubError(reason.kind, `Re-ran ${worked} of ${results.length}. ${reason.message}`);
  }
  return paths.size;
}

export const MARK_READY_MUTATION = /* GraphQL */ `
mutation ProwlMarkReady($id: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } }
}`;

export const CONVERT_TO_DRAFT_MUTATION = /* GraphQL */ `
mutation ProwlConvertToDraft($id: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } }
}`;

type DraftPayload = { pullRequest: { isDraft: boolean } | null } | null;

/** Converts the pull request to a draft (`draft: true`) or marks it ready for review. */
export async function setDraft(client: GitHubClient, prId: string, draft: boolean): Promise<void> {
  const data = await client.graphql<{
    markPullRequestReadyForReview?: DraftPayload;
    convertPullRequestToDraft?: DraftPayload;
  }>(draft ? CONVERT_TO_DRAFT_MUTATION : MARK_READY_MUTATION, { id: prId });
  const payload = draft ? data.convertPullRequestToDraft : data.markPullRequestReadyForReview;
  if (payload?.pullRequest?.isDraft !== draft) {
    throw new GitHubError('server', 'GitHub did not confirm the change.');
  }
}
