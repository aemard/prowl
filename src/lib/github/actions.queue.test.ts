import { describe, expect, it } from 'vitest';
import { dequeuePullRequest, enqueuePullRequest } from './actions';
import { setup } from './actions.test-support';
import { GitHubError } from './errors';

describe('merge queue actions', () => {
  it('enqueues at the head the user saw, and dequeues', async () => {
    const queued = setup({ enqueuePullRequest: { mergeQueueEntry: { position: 1 } } });
    await enqueuePullRequest(queued.client, 'PR_1', 'abc');
    expect(queued.sent[0]?.variables).toEqual({ id: 'PR_1', oid: 'abc' });
    const out = setup({ dequeuePullRequest: { mergeQueueEntry: { id: 'Q' } } });
    await dequeuePullRequest(out.client, 'PR_1');
    expect(out.sent[0]?.variables).toEqual({ id: 'PR_1' });
  });

  it('fails when GitHub does not confirm', async () => {
    await expect(enqueuePullRequest(setup({}).client, 'PR_1', 'abc')).rejects.toBeInstanceOf(
      GitHubError,
    );
    await expect(dequeuePullRequest(setup({}).client, 'PR_1')).rejects.toBeInstanceOf(GitHubError);
  });
});
