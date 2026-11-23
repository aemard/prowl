import type { Worker } from '@playwright/test';
import type { PollState } from '../../src/lib/model';
import { headCommit, prNode, RECENT_COMMIT, searchResponse } from '../fixtures/github';
import { notificationThread } from '../fixtures/notifications';
import { expect, test } from './fixtures';
import type { MockGitHub } from './mock-github/server';

const LAST = 'Thu, 05 Nov 2026 10:00:00 GMT';
const LATER = 'Thu, 05 Nov 2026 10:05:00 GMT';
const LATEST = '2026-11-05T10:04:45Z';

/**
 * Ages the list past the fast lane's floors (a minute for the inbox, 2 for the CI watch), then
 * fires the worker's `inbox` alarm now (unpacked extensions have no minimum delay).
 */
const fireInbox = (worker: Worker) =>
  worker.evaluate(async () => {
    const { snapshot } = await chrome.storage.local.get<{ snapshot?: object }>('snapshot');
    const fetchedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    if (snapshot) await chrome.storage.local.set({ snapshot: { ...snapshot, fetchedAt } });
    await chrome.alarms.create('inbox', { when: Date.now() + 50 });
  });
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
      notificationThread({ type: 'Issue', updatedAt: '2026-11-05T10:04:00Z' }),
      // A repository the viewer watches, where the list shows nothing: no news for it.
      notificationThread({ updatedAt: LATEST, reason: 'subscribed', repo: 'watched/repo' }),
      notificationThread({ updatedAt: threadUpdatedAt }),
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

test('an unchanged inbox answers 304 to the worker: If-Modified-Since is sent, nothing polls', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  github.on('GET', '/notifications', (request) =>
    request.headers['if-modified-since'] === LAST
      ? { status: 304, headers: { 'last-modified': LAST } }
      : { headers: { 'last-modified': LAST }, body: [] },
  );
  await signIn();
  await poll();
  await serviceWorker.evaluate(
    (lastModified) => chrome.storage.session.set({ inbox: { lastModified } }),
    LAST,
  );
  const before = searches(github);
  await fireInbox(serviceWorker);
  await expect.poll(() => inboxReads(github).length).toBe(1);
  expect(inboxReads(github)[0]?.headers['if-modified-since']).toBe(LAST);
  // Stored only once checkInbox took the 304 as an answer (a thrown error stores no nextAt).
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => (await chrome.storage.session.get('inbox')).inbox),
    )
    .toMatchObject({ lastModified: LAST, nextAt: expect.any(String) });
  await settle(serviceWorker);
  expect(searches(github)).toBe(before);
});

test("the CI watch polls for running CI on the viewer's own PR, not on a teammate's", async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  let author = 'alice';
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      [
        prNode({
          author: { __typename: 'User', login: author, avatarUrl: '' },
          updatedAt: RECENT_COMMIT,
          commits: headCommit({ IN_PROGRESS: 1 }),
        }),
      ],
      variables,
    ),
  );
  // A fine-grained token keeps the inbox out of it: only the CI watch can poll.
  await signIn({ tokenType: 'fine_grained' });
  const watch = async () => {
    await fireInbox(serviceWorker);
    await settle(serviceWorker);
  };
  await poll();
  const before = searches(github);
  await watch();
  expect(searches(github)).toBe(before);

  author = 'octocat';
  await poll();
  const mine = searches(github);
  await watch();
  await expect.poll(() => searches(github)).toBeGreaterThan(mine);
});
