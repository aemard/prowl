import type { Worker } from '@playwright/test';
import type { CheckState } from '../../src/lib/model';
import { headCommit, prId, prNode, searchResponse } from '../fixtures/github';
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
