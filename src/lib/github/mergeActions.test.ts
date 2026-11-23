import { describe, expect, it } from 'vitest';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import { setup } from './actions.test-support';
import { GitHubError } from './errors';
import {
  DISABLE_AUTO_MERGE_MUTATION,
  dequeuePullRequest,
  ENABLE_AUTO_MERGE_MUTATION,
  enqueuePullRequest,
  MERGE_MUTATION,
  mergePullRequest,
  setAutoMerge,
} from './mergeActions';

const merged = { mergePullRequest: { pullRequest: { merged: true } } };
const head = 'a'.repeat(40);

describe('mergePullRequest', () => {
  it('merges with the method and the head commit that was looked at', async () => {
    const { client, sent } = setup(merged);
    await mergePullRequest(client, 'PR_1', { method: 'squash', headSha: head });
    expect(sent).toEqual([
      { query: MERGE_MUTATION, variables: { id: 'PR_1', method: 'SQUASH', oid: head } },
    ]);
    expect(MERGE_MUTATION).toContain('mutation ProwlMerge(');
    expect(MERGE_MUTATION).toContain('$oid: GitObjectID!');
    expect(MERGE_MUTATION).toContain('expectedHeadOid: $oid');
  });

  it('sends each method in the enum’s spelling', async () => {
    const { client, sent } = setup(merged);
    for (const method of ['merge', 'squash', 'rebase'] as const) {
      await mergePullRequest(client, 'PR_1', { method, headSha: head });
    }
    expect(sent.map((request) => request.variables.method)).toEqual(['MERGE', 'SQUASH', 'REBASE']);
  });

  it('adds a trimmed commit title for a merge or squash commit, not for a rebase', async () => {
    const { client, sent } = setup(merged);
    await mergePullRequest(client, 'PR_1', { method: 'merge', headSha: head, title: ' Ship it ' });
    await mergePullRequest(client, 'PR_1', { method: 'squash', headSha: head, title: '  ' });
    await mergePullRequest(client, 'PR_1', { method: 'rebase', headSha: head, title: 'Ignored' });
    expect(sent.map((request) => request.variables.headline)).toEqual([
      'Ship it',
      undefined,
      undefined,
    ]);
  });

  it('does not report success when GitHub confirms nothing', async () => {
    for (const data of [
      { mergePullRequest: null },
      { mergePullRequest: { pullRequest: null } },
      { mergePullRequest: { pullRequest: { merged: false } } },
    ]) {
      await expect(
        mergePullRequest(setup(data).client, 'PR_1', { method: 'merge', headSha: head }),
      ).rejects.toMatchObject({ kind: 'server', message: 'GitHub did not confirm the merge.' });
    }
  });

  it('says why GitHub refused, without the token', async () => {
    for (const message of [
      'Head branch was modified. Review and try the merge again.',
      'Pull request is not mergeable ghp_secret',
    ]) {
      const { client } = setup(
        jsonResponse({ data: null, errors: [graphqlError('UNPROCESSABLE', message)] }),
      );
      const error = await mergePullRequest(client, 'PR_1', {
        method: 'merge',
        headSha: head,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).message).toBe(message.replace('ghp_secret', '[redacted]'));
    }
  });
});

describe('setAutoMerge', () => {
  it('turns auto-merge on with a method pinned to the head, and off', async () => {
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

  it('fails when GitHub does not confirm the new state', async () => {
    const stillOff = setup({
      enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } },
    });
    await expect(setAutoMerge(stillOff.client, 'PR_1', 'merge', 'abc')).rejects.toMatchObject({
      kind: 'server',
    });
    const stillOn = setup({
      disablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { mergeMethod: 'MERGE' }, isInMergeQueue: false },
      },
    });
    await expect(setAutoMerge(stillOn.client, 'PR_1', null, 'abc')).rejects.toMatchObject({
      message: 'GitHub did not confirm the change.',
    });
    const empty = setup({ disablePullRequestAutoMerge: null });
    await expect(setAutoMerge(empty.client, 'PR_1', null, 'abc')).rejects.toBeInstanceOf(
      GitHubError,
    );
  });
});

it('accepts "Merge when ready" that GitHub answers by queuing the PR at once', async () => {
  const queued = setup({
    enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null, isInMergeQueue: true } },
  });
  await expect(setAutoMerge(queued.client, 'PR_1', 'merge', 'abc')).resolves.toBeUndefined();
  expect(ENABLE_AUTO_MERGE_MUTATION).toContain('isInMergeQueue');
});

describe('merge queue actions', () => {
  it('enqueues at the head the user saw, and dequeues', async () => {
    const queued = setup({ enqueuePullRequest: { mergeQueueEntry: { position: 1 } } });
    await enqueuePullRequest(queued.client, 'PR_1', 'abc');
    expect(queued.sent[0]?.variables).toEqual({ id: 'PR_1', oid: 'abc' });
    const out = setup({ dequeuePullRequest: { mergeQueueEntry: { id: 'Q' } } });
    await dequeuePullRequest(out.client, 'PR_1');
    expect(out.sent[0]?.variables).toEqual({ id: 'PR_1' });
  });

  it('fails when GitHub does not confirm, not that it merged', async () => {
    const queue = { kind: 'server', message: 'GitHub did not confirm the change.' };
    await expect(enqueuePullRequest(setup({}).client, 'PR_1', 'abc')).rejects.toMatchObject(queue);
    await expect(dequeuePullRequest(setup({}).client, 'PR_1')).rejects.toMatchObject(queue);
  });
});
