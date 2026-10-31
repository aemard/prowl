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
  expectNoA11yViolations,
}) => {
  const node = prNode({ title: 'Visible before merge completes', mergeStateStatus: 'CLEAN' });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseSearch = () => {};
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  github.onGraphQL('ProwlSearch', async (vars) => {
    await searchGate;
    return searchResponse([node], vars);
  });
  github.onGraphQL('ProwlMergeState', async ({ ids }) => {
    await gate;
    return mergeStateResponse(ids, [node]);
  });
  await signIn();
  const panel = await openPanel();
  const refresh = panel.getByRole('button', { name: 'Refresh', exact: true });
  await refresh.click();
  const loading = poll();
  try {
    await expect(refresh).toHaveAttribute('aria-busy', 'true');
    releaseSearch();
    await expect(panel.getByText('Visible before merge completes', { exact: true })).toBeVisible();
    await expect.poll(() => github.requestsFor('ProwlMergeState').length).toBe(1);
    expect(
      await serviceWorker.evaluate(
        async () =>
          (await chrome.storage.local.get<{ pollState: PollState }>('pollState')).pollState
            .inFlight,
      ),
    ).toBe(true);
    await expect(refresh).toBeEnabled();
    await expect(refresh).not.toHaveAttribute('aria-busy');
    await expect(panel.getByTitle('Checking the latest merge status on GitHub')).toBeVisible();
    await expect(panel.locator('[role="status"][aria-live="polite"]').last()).toHaveText(
      'Updated. 1 pull request.',
    );
    await expectNoA11yViolations(panel);
    for (const scheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: scheme });
      await panel.screenshot({ path: test.info().outputPath(`merge-updating-${scheme}.png`) });
    }
  } finally {
    releaseSearch();
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
  await expect(panel.getByTitle('Checking the latest merge status on GitHub')).toHaveCount(0);
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
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  github.onGraphQL('ProwlMergeState', async ({ ids }) => {
    await gate;
    return mergeStateResponse(ids, [node]);
  });
  const panel = await openPanel();
  const toggle = panel.getByRole('button', { name: 'Details for Refresh only this card' });
  await toggle.click();
  try {
    await expect(panel.getByTitle('Checking the latest merge status on GitHub')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).not.toHaveAttribute(
      'aria-busy',
    );
  } finally {
    release();
  }
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
  await expect(panel.getByTitle('Checking the latest merge status on GitHub')).toHaveCount(0);
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

test('clears card progress and keeps the global loader stopped after enrichment fails', async ({
  github,
  signIn,
  openPanel,
  poll,
}) => {
  const node = prNode({ title: 'List stays available after merge failure' });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  github.onGraphQL('ProwlSearch', (vars) => searchResponse([node], vars));
  github.onGraphQL('ProwlMergeState', async () => {
    await gate;
    return { status: 401, body: { message: 'Bad credentials' } };
  });
  await signIn();
  const panel = await openPanel();
  const loading = poll();
  try {
    await expect(panel.getByTitle('Checking the latest merge status on GitHub')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).not.toHaveAttribute(
      'aria-busy',
    );
  } finally {
    release();
    await loading;
  }
  await expect(panel.getByTitle('Checking the latest merge status on GitHub')).toHaveCount(0);
  await expect(
    panel.getByText('List stays available after merge failure', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).not.toHaveAttribute(
    'aria-busy',
  );
  await expect(panel.getByText('Your GitHub token was revoked or expired')).toBeVisible();
});
