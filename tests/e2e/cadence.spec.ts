import type { Worker } from '@playwright/test';
import type { PollState } from '../../src/lib/model';
import { prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import type { MockGitHub } from './mock-github/server';

const LAST = 'Thu, 05 Nov 2026 10:00:00 GMT';
const LATER = 'Thu, 05 Nov 2026 10:05:00 GMT';

/** Fires the worker's `inbox` alarm now (unpacked extensions have no minimum delay). */
const fireInbox = (worker: Worker) =>
  worker.evaluate(() => chrome.alarms.create('inbox', { when: Date.now() + 50 }));
const inboxReads = (github: MockGitHub) =>
  github.requests.filter((request) => request.path.startsWith('/notifications'));
const searches = (github: MockGitHub) => github.requestsFor('ProwlSearch').length;
const pollState = (worker: Worker) =>
  worker.evaluate(
    async () => (await chrome.storage.local.get('pollState')).pollState as PollState | undefined,
  );
/** Lets anything a trigger started reach the mock. */
const settle = (worker: Worker) => worker.evaluate(() => new Promise((r) => setTimeout(r, 500)));

test.beforeEach(({ github }) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([prNode()], variables));
});

test('an inbox thread updated since the last check polls; old unread ones do not', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  let threadUpdatedAt = '2026-11-01T08:00:00Z';
  github.on('GET', '/notifications', () => ({
    headers: { 'last-modified': LATER },
    body: [
      { subject: { type: 'Issue' }, updated_at: '2026-11-05T10:04:00Z' },
      { subject: { type: 'PullRequest' }, updated_at: threadUpdatedAt },
    ],
  }));
  await signIn();
  await poll();
  await serviceWorker.evaluate(
    (lastModified) => chrome.storage.session.set({ inbox: { lastModified } }),
    LAST,
  );
  const before = searches(github);
  await fireInbox(serviceWorker);
  await expect.poll(() => inboxReads(github).length).toBe(1);
  await settle(serviceWorker);
  expect(searches(github)).toBe(before);

  threadUpdatedAt = '2026-11-05T10:04:30Z';
  await serviceWorker.evaluate(
    (lastModified) => chrome.storage.session.set({ inbox: { lastModified } }),
    LAST,
  );
  await fireInbox(serviceWorker);
  await expect.poll(() => searches(github)).toBe(before + 1);
});

test('a token the inbox finds rejected stops polling and clears both alarms', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  github.on('GET', '/notifications', () => ({ status: 401, body: { message: 'Bad credentials' } }));
  await signIn();
  await poll();
  await fireInbox(serviceWorker);
  await expect
    .poll(async () => (await pollState(serviceWorker))?.lastError?.kind)
    .toBe('unauthorized');
  await expect
    .poll(() => serviceWorker.evaluate(async () => (await chrome.alarms.getAll()).length))
    .toBe(0);
  const reads = inboxReads(github).length;
  await fireInbox(serviceWorker);
  await settle(serviceWorker);
  expect(inboxReads(github)).toHaveLength(reads);
});

test('opening the panel during a backoff asks GitHub nothing', async ({
  github,
  signIn,
  seedStorage,
  openPanel,
  serviceWorker,
}) => {
  await signIn();
  await seedStorage({
    pollState: {
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: null,
      nextAllowedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      consecutiveFailures: 1,
      rateLimit: null,
      lastError: { kind: 'network', message: 'Could not reach GitHub.' },
      inFlight: false,
    },
  });
  const before = searches(github);
  const panel = await openPanel();
  await panel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle(serviceWorker);
  expect(searches(github)).toBe(before);
});
