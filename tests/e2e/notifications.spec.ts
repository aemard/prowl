import type { Worker } from '@playwright/test';
import type { CheckState } from '../../src/lib/model';
import {
  closedNode,
  headCommit,
  nodesResponse,
  prId,
  prNode,
  reviewNode,
  searchResponse,
} from '../fixtures/github';
import { expect, test } from './fixtures';

const SHA = 'a'.repeat(40);
const CHECKS: Record<CheckState, Record<string, number> | null> = {
  success: { SUCCESS: 2 },
  failure: { SUCCESS: 1, FAILURE: 1 },
  pending: { SUCCESS: 1, IN_PROGRESS: 1 },
  none: null,
};

/** Ids of the notifications Chrome shows for the extension. */
const shown = (worker: Worker) =>
  worker.evaluate(async () => Object.keys(await chrome.notifications.getAll()));

/** Serves PRs 1..`count` whose CI is in `state.checks`. */
function serve(github: Parameters<Parameters<typeof test>[2]>[0]['github'], count = 1) {
  const state = { checks: 'pending' as CheckState };
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      Array.from({ length: count }, (_, i) =>
        prNode({ number: i + 1, commits: headCommit(CHECKS[state.checks]) }),
      ),
      variables,
    ),
  );
  return state;
}

test('CI going from pending to failed notifies once per commit', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  const state = serve(github);
  await signIn();
  await poll();
  expect(await shown(serviceWorker)).toEqual([]);

  state.checks = 'failure';
  await poll();
  const id = `${prId(1)}:ci_failed:${SHA}`;
  expect(await shown(serviceWorker)).toEqual([id]);

  // The same change again (a re-run that fails on the same commit) is not news.
  await serviceWorker.evaluate((notification) => chrome.notifications.clear(notification), id);
  for (const checks of ['pending', 'failure'] as const) {
    state.checks = checks;
    await poll();
  }
  expect(await shown(serviceWorker)).toEqual([]);
});

test('a muted pull request produces no notification', async ({
  github,
  signIn,
  seedStorage,
  poll,
  serviceWorker,
}) => {
  const state = serve(github, 2);
  await signIn();
  await seedStorage({ prLocal: { snoozed: {}, muted: { [prId(1)]: true }, seen: {} } });
  await poll();
  state.checks = 'failure';
  await poll();
  expect(await shown(serviceWorker)).toEqual([`${prId(2)}:ci_failed:${SHA}`]);
});

test('switched-off events and quiet hours produce no notification', async ({
  github,
  signIn,
  seedStorage,
  poll,
  serviceWorker,
}) => {
  const state = serve(github);
  await signIn();
  await poll();

  await seedStorage({ settings: { notifications: { events: { ci_failed: false } } } });
  state.checks = 'failure';
  await poll();
  expect(await shown(serviceWorker)).toEqual([]);

  // A window around now, written in the browser's local time.
  const hour = (offset: number) =>
    `${String((new Date().getHours() + offset + 24) % 24).padStart(2, '0')}:00`;
  await seedStorage({
    settings: { notifications: { quietHours: { enabled: true, start: hour(-1), end: hour(1) } } },
  });
  state.checks = 'pending';
  await poll();
  state.checks = 'failure';
  await poll();
  expect(await shown(serviceWorker)).toEqual([]);
});

test('more than three events in one poll become one summary', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  const state = serve(github, 4);
  await signIn();
  await poll();
  state.checks = 'failure';
  await poll();
  const ids = await shown(serviceWorker);
  expect(ids).toHaveLength(1);
  expect(ids[0]).toMatch(/^summary:/);
});

test('signing out clears the notifications', async ({
  github,
  signIn,
  poll,
  openPanel,
  serviceWorker,
}) => {
  const state = serve(github);
  await signIn();
  await poll();
  state.checks = 'failure';
  await poll();
  expect(await shown(serviceWorker)).toHaveLength(1);

  const panel = await openPanel();
  await serviceWorker.evaluate(() => chrome.storage.local.remove(['auth', 'snapshot']));
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'signedOut' }));
  expect(await shown(serviceWorker)).toEqual([]);
});

test('every kind of change by someone else notifies with its own event', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  // PR 1 walks through every in-place change; PRs 2 and 3 get merged and closed by others.
  type Fields = Partial<Parameters<typeof prNode>[0]>;
  let one: Fields = { number: 1, commits: headCommit(CHECKS.failure) };
  const open = new Set([1, 2, 3]);
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      [prNode(one), prNode({ number: 2 }), prNode({ number: 3 })].filter((pr) =>
        open.has(pr.number),
      ),
      variables,
    ),
  );
  github.onGraphQL('ProwlNodes', (variables) =>
    nodesResponse(variables.ids, [
      closedNode(prId(2), { state: 'MERGED', by: 'alice' }),
      closedNode(prId(3), { state: 'CLOSED', by: 'bob' }),
    ]),
  );
  await signIn();
  await poll();

  /** Applies `change`, polls, and returns the event types notified by that poll. */
  const after = async (change: () => void) => {
    await serviceWorker.evaluate(async () => {
      for (const id of Object.keys(await chrome.notifications.getAll()))
        await chrome.notifications.clear(id);
    });
    change();
    await poll();
    return (await shown(serviceWorker)).map((id) => id.split(':')[1]).sort();
  };
  const reviews = (...nodes: ReturnType<typeof reviewNode>[]) => ({ latestReviews: { nodes } });

  // CI passed after a failure, across a pending run in between.
  expect(await after(() => (one = { ...one, commits: headCommit(CHECKS.pending) }))).toEqual([]);
  expect(await after(() => (one = { ...one, commits: headCommit(CHECKS.success) }))).toEqual([
    'ci_passed',
  ]);
  expect(
    await after(() => (one = { ...one, ...reviews(reviewNode('alice', 'COMMENTED')) })),
  ).toEqual(['review_new']);
  expect(
    await after(
      () =>
        (one = {
          ...one,
          ...reviews(reviewNode('alice', 'COMMENTED'), reviewNode('bob', 'APPROVED')),
        }),
    ),
  ).toEqual(['approved']);
  expect(
    await after(
      () =>
        (one = {
          ...one,
          ...reviews(
            reviewNode('alice', 'COMMENTED'),
            reviewNode('bob', 'APPROVED'),
            reviewNode('carol', 'CHANGES_REQUESTED'),
          ),
        }),
    ),
  ).toEqual(['changes_requested']);
  expect(
    await after(
      () =>
        (one = {
          ...one,
          totalCommentsCount: 1,
          comments: { nodes: [{ createdAt: '2026-10-06T09:00:00Z', author: { login: 'dave' } }] },
        }),
    ),
  ).toEqual(['comment_new']);
  expect(
    await after(
      () =>
        (one = {
          ...one,
          ...reviews(reviewNode('bob', 'APPROVED')),
          reviewDecision: 'APPROVED',
          mergeStateStatus: 'CLEAN',
        }),
    ),
  ).toEqual(['ready_to_merge']);
  expect(await after(() => open.delete(2))).toEqual(['merged']);
  expect(await after(() => open.delete(3))).toEqual(['closed']);
});
