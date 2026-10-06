import type { Worker } from '@playwright/test';
import { headCommit, prId, prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';

// `--color-danger-solid` and `--color-accent-solid` as RGBA.
const DANGER = [201, 34, 46, 255];
const ACCENT = [59, 79, 216, 255];

/** The toolbar icon as Chrome has it: what a user sees and the tooltip they hover. */
const icon = (worker: Worker) =>
  worker.evaluate(async () => ({
    text: await chrome.action.getBadgeText({}),
    color: await chrome.action.getBadgeBackgroundColor({}),
    title: await chrome.action.getTitle({}),
  }));
const badgeText = (worker: Worker) => () => icon(worker).then(({ text }) => text);

/** PR 1 fails CI while `state.failing`, PR 2 is ready to merge, PR 3 needs nothing. */
function serve(github: Parameters<Parameters<typeof test>[2]>[0]['github']) {
  const state = { failing: true, updatedAt: '2026-10-05T12:00:00Z' };
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      [
        prNode({
          number: 1,
          updatedAt: state.updatedAt,
          commits: headCommit(state.failing ? { FAILURE: 1 } : { SUCCESS: 1 }),
        }),
        prNode({ number: 2, mergeStateStatus: 'CLEAN' }),
        prNode({ number: 3 }),
      ],
      variables,
    ),
  );
  return state;
}

test('counts the pull requests that need attention, red while CI fails', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  const state = serve(github);
  await signIn();
  expect(await icon(serviceWorker)).toMatchObject({ text: '', title: 'Prowl' });

  await poll();
  expect(await icon(serviceWorker)).toEqual({
    text: '2',
    color: DANGER,
    title: 'Prowl: 2 pull requests needing attention (1 CI failing, 1 ready to merge)',
  });

  state.failing = false;
  await poll();
  expect(await icon(serviceWorker)).toEqual({
    text: '1',
    color: ACCENT,
    title: 'Prowl: 1 pull request needing attention (1 ready to merge)',
  });
});

test('follows what the panel writes: snooze, unsnooze, seen, badge mode', async ({
  github,
  signIn,
  poll,
  openPanel,
  serviceWorker,
}) => {
  const state = serve(github);
  await signIn();
  await poll();
  const text = badgeText(serviceWorker);
  await expect.poll(text).toBe('2');

  const panel = await openPanel();
  const write = (items: Record<string, unknown>) =>
    panel.evaluate((stored) => chrome.storage.local.set(stored), items);
  const local = (prLocal: object) =>
    write({ prLocal: { snoozed: {}, muted: {}, seen: {}, ...prLocal } });

  await local({ snoozed: { [prId(1)]: new Date(Date.now() + 3_600_000).toISOString() } });
  await expect.poll(text).toBe('1');
  // A muted pull request still counts: mute only silences notifications.
  await local({ muted: { [prId(1)]: true } });
  await expect.poll(text).toBe('2');
  await local({});

  // Unseen: all three pull requests are new to this user until the panel marks them seen.
  await write({ settings: { badge: 'unseen' } });
  await expect.poll(text).toBe('3');
  expect((await icon(serviceWorker)).title).toBe('Prowl: 3 pull requests with unseen changes');
  await panel.evaluate(
    (prIds) => chrome.runtime.sendMessage({ type: 'markSeen', prIds }),
    [prId(1), prId(2), prId(3)],
  );
  await expect.poll(text).toBe('');

  // Activity after the user looked brings the badge back with the next poll.
  state.updatedAt = '2026-10-06T09:00:00Z';
  await poll();
  await expect.poll(text).toBe('1');
  expect((await icon(serviceWorker)).color).toEqual(DANGER);

  await write({ settings: { badge: 'off' } });
  await expect.poll(text).toBe('');
});

test('is cleared by sign-out', async ({ github, signIn, poll, openPanel, serviceWorker }) => {
  serve(github);
  await signIn();
  await poll();
  const text = badgeText(serviceWorker);
  await expect.poll(text).toBe('2');

  const panel = await openPanel();
  await panel.evaluate(() => chrome.storage.local.remove(['auth', 'snapshot', 'pollState']));
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'signedOut' }));
  expect(await icon(serviceWorker)).toMatchObject({ text: '', title: 'Prowl' });
});
