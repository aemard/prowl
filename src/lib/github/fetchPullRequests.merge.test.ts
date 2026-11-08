import { describe, expect, it } from 'vitest';
import { mergeStateResponse, prId, prNode } from '../../../tests/fixtures/github';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, settings, setup } from './fetchPullRequests.test-support';
import type { PullRequestNode } from './queries';

const MINUTE = 60_000;
const merge = (calls: { operation: string; variables: Record<string, unknown> }[]) =>
  calls.filter((c) => c.operation === 'ProwlMergeState').map((c) => c.variables.ids);

describe('fetchPullRequests', () => {
  describe('merge facts', () => {
    it('reads them in batches of 10 for the PRs found', async () => {
      const nodes = Array.from({ length: 12 }, (_, i) =>
        prNode({ number: i + 1, mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED' }),
      );
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const result = await fetchPullRequests(client, settings());
      expect(merge(calls).map((ids) => (ids as string[]).length)).toEqual([10, 2]);
      expect(result.pullRequests[prId(12)]).toMatchObject({
        mergeStateStatus: 'clean',
        reviewDecision: 'approved',
      });
      expect(Object.keys(result.mergeStateAt)).toHaveLength(12);
    });

    it('publishes the list before merge reads and each completed batch, honoring new priorities', async () => {
      const nodes = Array.from({ length: 25 }, (_, i) => prNode({ number: i + 1 }));
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const progress: number[] = [];
      const pendingBatches: string[][] = [];
      let priority: string[] = [];
      await fetchPullRequests(
        client,
        settings(),
        null,
        null,
        undefined,
        async (result, pending) => {
          pendingBatches.push(pending);
          progress.push(Object.keys(result.mergeStateAt).length);
          expect(Object.keys(result.pullRequests)).toHaveLength(25);
          if (progress.length === 1) expect(merge(calls)).toEqual([]);
          if (progress.length === 1) priority = [prId(25)];
        },
        () => priority,
      );
      expect(progress).toEqual([0, 10, 20]);
      expect(pendingBatches.map((ids) => ids.length)).toEqual([10, 10, 0]);
      expect(pendingBatches[1]?.[0]).toBe(prId(25));
      expect(merge(calls).flat()[10]).toBe(prId(25));
    });

    it('bounds merge work and gives deferred PRs a turn on the next poll', async () => {
      const nodes = Array.from({ length: 35 }, (_, i) => prNode({ number: i + 1 }));
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const first = await fetchPullRequests(client, settings());
      expect(merge(calls).flat()).toHaveLength(20);
      expect(Object.keys(first.pullRequests)).toHaveLength(35);
      calls.length = 0;
      const next = await fetchPullRequests(client, settings(), first);
      expect(merge(calls).flat()).toEqual(nodes.slice(20).map(({ id }) => id));
      expect(Object.keys(next.mergeStateAt)).toHaveLength(35);
    });

    it('keeps changed deferred facts due until they are actually read', async () => {
      const nodes = Array.from({ length: 21 }, (_, i) => prNode({ number: i + 1 }));
      const previous = {
        pullRequests: Object.fromEntries(
          nodes.map((node) => [node.id, { ...mapped(node), title: 'Old title' }]),
        ),
        mergeStateAt: Object.fromEntries(nodes.map((node) => [node.id, new Date().toISOString()])),
      };
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const first = await fetchPullRequests(client, settings(), previous);
      expect(first.pullRequests[prId(21)]?.mergeStateStatus).toBe(
        previous.pullRequests[prId(21)]?.mergeStateStatus,
      );
      expect(first.mergeStateAt[prId(21)]).toBeUndefined();
      calls.length = 0;
      await fetchPullRequests(client, settings(), first);
      expect(merge(calls).flat()).toEqual([prId(21)]);
    });

    it('prioritizes visible PRs and reuses hidden and snoozed facts for an hour', async () => {
      const nodes = Array.from({ length: 25 }, (_, i) =>
        prNode({ number: i + 1, isDraft: i < 10, mergeStateStatus: 'CLEAN' }),
      );
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const prefs = settings({ hideDrafts: true });
      const first = await fetchPullRequests(client, prefs);
      expect(merge(calls).flat().slice(0, 15)).toEqual(nodes.slice(10).map(({ id }) => id));
      const readAt = new Date(Date.now() - 30 * MINUTE).toISOString();
      const previous = {
        pullRequests: Object.fromEntries(nodes.map((node) => [node.id, mapped(node)])),
        mergeStateAt: Object.fromEntries(nodes.map((node) => [node.id, readAt])),
      };
      calls.length = 0;
      const local = {
        snoozed: { [prId(11)]: new Date(Date.now() + MINUTE).toISOString() },
        muted: {},
        seen: {},
      };
      const next = await fetchPullRequests(client, prefs, previous, null, local);
      expect(merge(calls).flat()).toEqual(nodes.slice(11).map(({ id }) => id));
      expect(next.mergeStateAt[prId(1)]).toBe(readAt);
      expect(next.mergeStateAt[prId(11)]).toBe(readAt);
      expect(Object.keys(first.pullRequests)).toHaveLength(25);
    });

    it('keeps them for an unchanged PR, and reads them again when it changed, is unknown or old', async () => {
      const now = Date.now();
      const node = (number: number) => prNode({ number, mergeStateStatus: 'CLEAN' });
      const [one, two, three, four] = [node(1), node(2), node(3), node(4)];
      const nodes = [one, two, three, four];
      const behind = (node: PullRequestNode) => ({
        ...mapped(node),
        mergeStateStatus: 'behind' as const,
      });
      const previous = {
        pullRequests: {
          [prId(1)]: behind(one),
          [prId(2)]: { ...behind(two), title: 'Renamed since' },
          [prId(3)]: { ...behind(three), mergeable: 'unknown' as const },
          [prId(4)]: behind(four),
        },
        mergeStateAt: {
          [prId(1)]: new Date(now - 5 * MINUTE).toISOString(),
          [prId(2)]: new Date(now - 5 * MINUTE).toISOString(),
          [prId(3)]: new Date(now - 5 * MINUTE).toISOString(),
          [prId(4)]: new Date(now - 15 * MINUTE).toISOString(),
        },
      };
      const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
      const result = await fetchPullRequests(client, settings(), previous);
      expect(merge(calls)).toEqual([[prId(4), prId(2), prId(3)]]);
      expect(result.pullRequests[prId(1)]?.mergeStateStatus).toBe('behind');
      expect(result.mergeStateAt[prId(1)]).toBe(previous.mergeStateAt[prId(1)]);
      expect(result.pullRequests[prId(4)]?.mergeStateStatus).toBe('clean');
    });

    it('keeps the previous facts of a batch GitHub gave up on, and reads them next time', async () => {
      const node = prNode({ number: 1, mergeStateStatus: 'CLEAN' });
      const previous = {
        pullRequests: {
          [node.id]: { ...mapped(node), title: 'Old', mergeStateStatus: 'behind' as const },
        },
      };
      const { client } = setup({
        ProwlSearch: bySearch({ 'author:@me': [node] }),
        ProwlMergeState: () => jsonResponse({ message: 'Bad gateway' }, { status: 504 }),
      });
      const result = await fetchPullRequests(client, settings(), previous);
      expect(result.pullRequests[node.id]?.mergeStateStatus).toBe('behind');
      expect(result.mergeStateAt).toEqual({});
    });

    it('fails the poll on a rejected token', async () => {
      const { client } = setup({
        ProwlSearch: bySearch({ 'author:@me': [prNode()] }),
        ProwlMergeState: () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
      });
      await expect(fetchPullRequests(client, settings())).rejects.toMatchObject({
        kind: 'unauthorized',
      });
    });
  });
});

describe('partial merge reads', () => {
  it('reads nothing from the nodes of a partial response, and says the section is incomplete', async () => {
    const [read, hole] = [prNode({ number: 1 }), prNode({ number: 2 })];
    const previous = {
      pullRequests: { [hole.id]: { ...mapped(hole), mergeStateStatus: 'behind' as const } },
    };
    const { client } = setup({
      ProwlSearch: bySearch({ 'author:@me': [read, hole] }),
      ProwlMergeState: ({ ids }) =>
        jsonResponse({
          // A null `reviewDecision` here is an error, not "no review required".
          data: mergeStateResponse(ids, [{ ...read, reviewDecision: null }]),
          errors: [
            graphqlError('FORBIDDEN', 'Cannot read reviews', ['nodes', 0, 'reviewDecision']),
            graphqlError('NOT_FOUND', 'Could not resolve to a node', ['nodes', 1]),
          ],
        }),
    });
    const result = await fetchPullRequests(client, settings(), previous);
    expect(result.pullRequests[read.id]).toMatchObject({
      reviewDecision: 'unknown',
      mergeStateStatus: 'unknown',
    });
    // The hole keeps what it had.
    expect(result.pullRequests[hole.id]?.mergeStateStatus).toBe('behind');
    expect(result.mergeStateAt).toEqual({});
    expect(result.sectionErrors.authored).toContain('Some merge requirements could not be read');
    expect(result.sectionErrors.authored).toContain('nodes.0.reviewDecision');
    expect(result.sectionCoverage?.authored?.partial).toBe(true);
  });
});
