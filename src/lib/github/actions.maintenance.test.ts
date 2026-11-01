import { expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import {
  CONVERT_TO_DRAFT_MUTATION,
  DISABLE_AUTO_MERGE_MUTATION,
  ENABLE_AUTO_MERGE_MUTATION,
  MARK_READY_MUTATION,
  rerunFailedChecks,
  setAutoMerge,
  setDraft,
  UPDATE_BRANCH_MUTATION,
  updateBranch,
} from './actions';
import { setup } from './actions.test-support';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';

const suites = (nodes: unknown[]) => ({
  node: {
    repository: { owner: { login: 'acme' }, name: 'web' },
    commits: { nodes: [{ commit: { checkSuites: { nodes } } }] },
  },
});

/** Routes GraphQL to `graph` and REST POSTs to `rest(path)`; records REST paths. */
function route(
  graph: object,
  rest: (path: string) => Response = () => new Response(null, { status: 201 }),
) {
  const posted: string[] = [];
  const fetch = vi.fn<FetchLike>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/graphql') return jsonResponse({ data: graph });
    posted.push(path);
    return rest(path);
  });
  const client = createGitHubClient({
    token: 'ghp_secret',
    apiUrl: 'https://api.github.com',
    fetch,
  });
  return { client, posted };
}

it('rerunFailedChecks re-runs failed Actions jobs and re-requests other failed suites, once each', async () => {
  const { client, posted } = route(
    suites([
      { databaseId: 1, conclusion: 'FAILURE', workflowRun: { databaseId: 77 } },
      { databaseId: 2, conclusion: 'TIMED_OUT', workflowRun: { databaseId: 77 } },
      { databaseId: 3, conclusion: 'STARTUP_FAILURE', workflowRun: null },
      { databaseId: 4, conclusion: 'SUCCESS', workflowRun: { databaseId: 78 } },
      { databaseId: 5, conclusion: 'CANCELLED', workflowRun: null },
      { databaseId: 6, conclusion: null, workflowRun: null },
      null,
    ]),
  );
  await expect(rerunFailedChecks(client, 'PR_1')).resolves.toBe(2);
  expect(posted.sort()).toEqual([
    '/repos/acme/web/actions/runs/77/rerun-failed-jobs',
    '/repos/acme/web/check-suites/3/rerequest',
  ]);
});

it('rerunFailedChecks says so when nothing failed', async () => {
  const { client, posted } = route(
    suites([{ databaseId: 1, conclusion: 'SUCCESS', workflowRun: null }]),
  );
  await expect(rerunFailedChecks(client, 'PR_1')).rejects.toMatchObject({
    kind: 'validation',
    message: 'No failed checks to re-run.',
  });
  expect(posted).toEqual([]);
});

it('rerunFailedChecks handles a missing pull request, commit or suite list', async () => {
  await expect(rerunFailedChecks(route({ node: null }).client, 'PR_1')).rejects.toMatchObject({
    kind: 'not_found',
  });
  const bare = { node: { repository: { owner: { login: 'a' }, name: 'b' } } };
  await expect(rerunFailedChecks(route(bare).client, 'PR_1')).rejects.toMatchObject({
    kind: 'validation',
  });
  const noSuites = {
    node: { ...bare.node, commits: { nodes: [{ commit: { checkSuites: null } }] } },
  };
  await expect(rerunFailedChecks(route(noSuites).client, 'PR_1')).rejects.toMatchObject({
    kind: 'validation',
  });
});

it('rerunFailedChecks reports partial and total failures with GitHub’s reason', async () => {
  const failing = suites([
    { databaseId: 1, conclusion: 'FAILURE', workflowRun: { databaseId: 77 } },
    { databaseId: 3, conclusion: 'FAILURE', workflowRun: null },
  ]);
  const forbidden = () => jsonResponse({ message: 'Must have admin rights' }, { status: 403 });
  const partial = route(failing, (path) =>
    path.includes('check-suites') ? forbidden() : new Response(null, { status: 201 }),
  );
  await expect(rerunFailedChecks(partial.client, 'PR_1')).rejects.toMatchObject({
    kind: 'forbidden',
    message: 'Re-ran 1 of 2. Must have admin rights',
  });
  const none = route(failing, forbidden);
  await expect(rerunFailedChecks(none.client, 'PR_1')).rejects.toMatchObject({
    kind: 'forbidden',
    message: 'Must have admin rights',
  });
});

it('setDraft converts to draft and marks ready with the named mutations', async () => {
  const toDraft = setup({ convertPullRequestToDraft: { pullRequest: { isDraft: true } } });
  await setDraft(toDraft.client, 'PR_1', true);
  expect(toDraft.sent).toEqual([{ query: CONVERT_TO_DRAFT_MUTATION, variables: { id: 'PR_1' } }]);
  const ready = setup({ markPullRequestReadyForReview: { pullRequest: { isDraft: false } } });
  await setDraft(ready.client, 'PR_1', false);
  expect(ready.sent).toEqual([{ query: MARK_READY_MUTATION, variables: { id: 'PR_1' } }]);
});

it('setDraft fails when GitHub does not confirm the new state', async () => {
  const unchanged = setup({ markPullRequestReadyForReview: { pullRequest: { isDraft: true } } });
  await expect(setDraft(unchanged.client, 'PR_1', false)).rejects.toMatchObject({
    kind: 'server',
  });
  const empty = setup({ convertPullRequestToDraft: null });
  await expect(setDraft(empty.client, 'PR_1', true)).rejects.toBeInstanceOf(GitHubError);
});

it('updateBranch merges or rebases the base in, pinned to the head it was asked on', async () => {
  const merged = setup({ updatePullRequestBranch: { pullRequest: { headRefOid: 'def' } } });
  await updateBranch(merged.client, 'PR_1', 'abc', 'merge');
  expect(merged.sent).toEqual([
    { query: UPDATE_BRANCH_MUTATION, variables: { id: 'PR_1', oid: 'abc', method: 'MERGE' } },
  ]);
  const rebased = setup({ updatePullRequestBranch: { pullRequest: { headRefOid: 'def' } } });
  await updateBranch(rebased.client, 'PR_1', 'abc', 'rebase');
  expect(rebased.sent[0]?.variables).toMatchObject({ method: 'REBASE' });
});

it('updateBranch fails when GitHub does not confirm the update', async () => {
  const empty = setup({ updatePullRequestBranch: null });
  await expect(updateBranch(empty.client, 'PR_1', 'abc', 'merge')).rejects.toMatchObject({
    kind: 'server',
  });
});

it('setAutoMerge turns auto-merge on with a method pinned to the head, and off', async () => {
  const on = setup({
    enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { mergeMethod: 'SQUASH' } } },
  });
  await setAutoMerge(on.client, 'PR_1', 'squash', 'abc');
  expect(on.sent).toEqual([
    {
      query: ENABLE_AUTO_MERGE_MUTATION,
      variables: { id: 'PR_1', method: 'SQUASH', oid: 'abc' },
    },
  ]);
  const off = setup({ disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } });
  await setAutoMerge(off.client, 'PR_1', null, 'abc');
  expect(off.sent).toEqual([{ query: DISABLE_AUTO_MERGE_MUTATION, variables: { id: 'PR_1' } }]);
});

it('setAutoMerge fails when GitHub does not confirm the new state', async () => {
  const stillOff = setup({
    enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } },
  });
  await expect(setAutoMerge(stillOff.client, 'PR_1', 'merge', 'abc')).rejects.toMatchObject({
    kind: 'server',
  });
  const empty = setup({ disablePullRequestAutoMerge: null });
  await expect(setAutoMerge(empty.client, 'PR_1', null, 'abc')).rejects.toBeInstanceOf(GitHubError);
});
