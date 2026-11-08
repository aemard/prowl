import { describe, expect, it } from 'vitest';
import { mergeStateResponse, prId, prNode } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../model';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, settings, setup } from './fetchPullRequests.test-support';

describe('merge facts across commits', () => {
  it('never publishes the previous head merge facts on a new commit, including a failed batch', async () => {
    const old = prNode({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' });
    const fresh = prNode({ headRefOid: 'b'.repeat(40) });
    const previous = { pullRequests: { [old.id]: mapped(old) } };
    const published: (PullRequest | undefined)[] = [];
    const { client } = setup({
      ProwlSearch: bySearch({ 'author:@me': [fresh] }),
      ProwlMergeState: () => jsonResponse({ message: 'Bad gateway' }, { status: 502 }),
    });
    const result = await fetchPullRequests(
      client,
      settings(),
      previous,
      null,
      undefined,
      async (snapshot) => {
        published.push(snapshot.pullRequests[old.id]);
      },
    );
    expect(published.length).toBeGreaterThan(0);
    for (const pr of [...published, result.pullRequests[old.id]]) {
      expect(pr?.headSha).toBe(fresh.headRefOid);
      expect(pr?.mergeStateStatus).toBe('unknown');
      expect(pr?.reviewDecision).toBe('unknown');
      expect(pr?.viewerCanUpdate).toBe(false);
    }
  });

  it('does not reuse old head facts for PRs outside the merge budget', async () => {
    const old = Array.from({ length: 21 }, (_, i) =>
      prNode({ number: i + 1, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
    );
    const fresh = old.map((pr) => ({ ...pr, headRefOid: 'b'.repeat(40) }));
    const { client } = setup({ ProwlSearch: bySearch({ 'author:@me': fresh }) });
    const result = await fetchPullRequests(client, settings(), {
      pullRequests: Object.fromEntries(old.map((pr) => [pr.id, mapped(pr)])),
    });
    expect(result.pullRequests[prId(21)]).toMatchObject({
      mergeStateStatus: 'unknown',
      reviewDecision: 'unknown',
      viewerCanUpdate: false,
    });
    expect(result.mergeStateAt[prId(21)]).toBeUndefined();
  });

  it.each(['b'.repeat(40), undefined])(
    'rejects a merge response with an unverified head (%s) during the poll',
    async (headRefOid) => {
      const node = prNode();
      const { client } = setup({
        ProwlSearch: bySearch({ 'author:@me': [node] }),
        ProwlMergeState: () => {
          const response = mergeStateResponse([node.id], [{ ...node, mergeStateStatus: 'CLEAN' }]);
          return { ...response, nodes: response.nodes?.map((item) => ({ ...item, headRefOid })) };
        },
      });
      const result = await fetchPullRequests(client, settings());
      expect(result.pullRequests[node.id]?.mergeStateStatus).toBe('unknown');
      expect(result.mergeStateAt[node.id]).toBeUndefined();
    },
  );
});
