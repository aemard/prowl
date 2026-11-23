/**
 * Keeping a pull request moving: re-running failed checks, the draft toggle and bringing the base
 * branch in. Conventions as in `reviewActions.ts`.
 */
import { t } from '../i18n';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';

/**
 * The check suites of the head commit, to find what failed. Each suite is either a GitHub
 * Actions workflow run (re-run only its failed jobs) or another app's suite (ask it to run again).
 */
export const FAILED_SUITES_QUERY = /* GraphQL */ `
query ProwlFailedSuites($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequest {
      headRefOid
      repository { owner { login } name }
      commits(last: 1) {
        nodes {
          commit {
            checkSuites(first: 50, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes { databaseId conclusion workflowRun { databaseId } }
            }
          }
        }
      }
    }
  }
}`;

interface FailedSuitesConnection {
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
  nodes: Array<{
    databaseId: number;
    conclusion: string | null;
    workflowRun: { databaseId: number } | null;
  } | null>;
}

interface FailedSuitesData {
  node: {
    headRefOid?: string;
    repository?: { owner: { login: string }; name: string };
    commits?: {
      nodes: Array<{
        commit: {
          checkSuites: FailedSuitesConnection | null;
        };
      } | null>;
    };
  } | null;
}

/** Bound the read to 250 suites; incomplete reads never start partial restarts. */
const MAX_SUITE_PAGES = 5;

/** Suite conclusions worth a re-run. Cancelled and skipped suites are left alone. */
const RERUNNABLE = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE']);

/**
 * Re-runs what failed on the head commit: the failed jobs of each failed Actions run
 * (`rerun-failed-jobs`), and every other failed suite (`rerequest`). Resolves to the number of
 * runs and suites restarted. When some restarts fail, it throws with how many worked.
 */
export async function rerunFailedChecks(client: GitHubClient, prId: string): Promise<number> {
  let { node } = await client.graphql<FailedSuitesData>(FAILED_SUITES_QUERY, {
    id: prId,
    after: null,
  });
  if (!node?.repository) throw new GitHubError('not_found', t('githubDidNotFindPullRequest'));
  const repo = `/repos/${encodeURIComponent(node.repository.owner.login)}/${encodeURIComponent(node.repository.name)}`;
  const head = node.headRefOid;
  const cursors = new Set<string>();
  const paths = new Set<string>();
  for (let page = 0; ; page++) {
    if (!node || (head && node.headRefOid && head !== node.headRefOid)) {
      throw new GitHubError('validation', t('headCommitChangedRefreshAndTryAgain'));
    }
    const suites: FailedSuitesConnection | null | undefined =
      node.commits?.nodes[0]?.commit.checkSuites;
    for (const suite of suites?.nodes ?? []) {
      if (!suite || !RERUNNABLE.has(suite.conclusion ?? '')) continue;
      paths.add(
        suite.workflowRun
          ? `${repo}/actions/runs/${suite.workflowRun.databaseId}/rerun-failed-jobs`
          : `${repo}/check-suites/${suite.databaseId}/rerequest`,
      );
    }
    if (!suites?.pageInfo?.hasNextPage) break;
    const cursor: string | null = suites.pageInfo.endCursor;
    if (page + 1 >= MAX_SUITE_PAGES || !cursor || cursors.has(cursor)) {
      throw new GitHubError('validation', t('notAllCheckSuitesCouldBeLoaded'));
    }
    cursors.add(cursor);
    ({ node } = await client.graphql<FailedSuitesData>(FAILED_SUITES_QUERY, {
      id: prId,
      after: cursor,
    }));
  }
  if (paths.size === 0) {
    throw new GitHubError('validation', t('noFailedCheckRunsToReRunHere'));
  }
  return restartChecks(client, paths);
}

/** Send one request at a time, retaining the first failure and the partial-success count. */
async function restartChecks(client: GitHubClient, paths: Set<string>): Promise<number> {
  let worked = 0;
  let failure: GitHubError | undefined;
  for (const path of paths) {
    try {
      await client.rest('POST', path);
      worked++;
    } catch (error) {
      failure ??=
        error instanceof GitHubError ? error : new GitHubError('server', t('somethingWentWrong'));
    }
  }
  if (failure) {
    throw worked === 0
      ? failure
      : new GitHubError(failure.kind, t('reRanOf', worked, paths.size, failure.message));
  }
  return worked;
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
    throw new GitHubError('server', t('githubDidNotConfirmChange'));
  }
}

export const UPDATE_BRANCH_MUTATION = /* GraphQL */ `
mutation ProwlUpdateBranch($id: ID!, $oid: GitObjectID!, $method: PullRequestBranchUpdateMethod!) {
  updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $oid, updateMethod: $method }) {
    pullRequest { headRefOid }
  }
}`;

/**
 * Brings the base branch into the pull request's branch, with a merge commit or by rebasing it,
 * unless its head is no longer `headSha`.
 */
export async function updateBranch(
  client: GitHubClient,
  prId: string,
  headSha: string,
  method: 'merge' | 'rebase',
): Promise<void> {
  const data = await client.graphql<{
    updatePullRequestBranch: { pullRequest: { headRefOid: string } | null } | null;
  }>(UPDATE_BRANCH_MUTATION, { id: prId, oid: headSha, method: method.toUpperCase() });
  if (!data.updatePullRequestBranch?.pullRequest) {
    throw new GitHubError('server', t('githubDidNotConfirmUpdate'));
  }
}
