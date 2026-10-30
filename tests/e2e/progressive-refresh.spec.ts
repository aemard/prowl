import { mapPullRequest } from '../../src/lib/github/mapPullRequest';
import type { PollState, Snapshot } from '../../src/lib/model';
import { buildSnapshotOf } from '../../src/test/panel';
import { mergeStateResponse, prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';

test('shows the new list while merge enrichment is still blocked', async ({
  github,
  signIn,
  openPanel,
  poll,
  serviceWorker,
}) => {
  const node = prNode({ title: 'Visible before merge completes', mergeStateStatus: 'CLEAN' });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  github.onGraphQL('ProwlSearch', (vars) => searchResponse([node], vars));
  github.onGraphQL('ProwlMergeState', async ({ ids }) => {
    await gate;
    return mergeStateResponse(ids, [node]);
  });
  await signIn();
  const panel = await openPanel();
  const loading = poll();
  try {
    await expect(panel.getByText('Visible before merge completes', { exact: true })).toBeVisible();
    await expect.poll(() => github.requestsFor('ProwlMergeState').length).toBe(1);
    expect(
      await serviceWorker.evaluate(
        async () =>
          (await chrome.storage.local.get<{ pollState: PollState }>('pollState')).pollState
            .inFlight,
      ),
    ).toBe(true);
  } finally {
    release();
    await loading;
  }
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const stored = await chrome.storage.local.get<{ snapshot: Snapshot; pollState: PollState }>(
          ['snapshot', 'pollState'],
        );
        return {
          inFlight: stored.pollState.inFlight,
          reads: Object.keys(stored.snapshot.mergeStateAt ?? {}).length,
        };
      }),
    )
    .toEqual({ inFlight: false, reads: 1 });
});

test('opening a cached card refreshes only its merge state and shares that read on reopen', async ({
  github,
  signIn,
  seedStorage,
  openPanel,
  serviceWorker,
}) => {
  const node = prNode({ title: 'Refresh only this card', mergeStateStatus: 'CLEAN' });
  const pr = { ...mapPullRequest(node), mergeStateStatus: 'blocked' as const };
  await signIn();
  await seedStorage({ snapshot: buildSnapshotOf({ authored: [pr] }) });
  github.onGraphQL('ProwlMergeState', ({ ids }) => mergeStateResponse(ids, [node]));
  const panel = await openPanel();
  const toggle = panel.getByRole('button', { name: 'Details for Refresh only this card' });
  await toggle.click();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async (id) =>
          (await chrome.storage.local.get<{ snapshot: Snapshot }>('snapshot')).snapshot
            .pullRequests[id]?.mergeStateStatus,
        pr.id,
      ),
    )
    .toBe('clean');
  expect(github.requestsFor('ProwlSearch')).toHaveLength(0);
  expect(github.requestsFor('ProwlMergeState')).toHaveLength(1);
  await toggle.click();
  await toggle.click();
  // Await the same typed request, serialized behind the click's request, without another API read.
  await panel.evaluate(
    (card) =>
      chrome.runtime.sendMessage({
        type: 'refreshMergeState',
        prId: card.id,
        headSha: card.headSha,
      }),
    pr,
  );
  expect(github.requestsFor('ProwlMergeState')).toHaveLength(1);
});
