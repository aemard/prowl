import type { Worker } from '@playwright/test';
import type { PollState, Snapshot } from '../../src/lib/model';
import { prId, prNode, searchResponse } from '../fixtures/github';
import { rateLimitHeaders } from '../fixtures/http';
import { expect, test } from './fixtures';

const stored = (worker: Worker) =>
  worker.evaluate(
    () =>
      chrome.storage.local.get(['snapshot', 'pollState']) as Promise<{
        snapshot?: Snapshot;
        pollState?: PollState;
      }>,
  );
const pollAlarm = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.alarms.get('poll')) ?? null);

test('a forced poll fetches from GitHub, stores a snapshot and schedules the next', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([prNode()], variables));
  await signIn();
  await poll();

  const [search, ...more] = github.requestsFor('ProwlSearch');
  expect(more).toEqual([]);
  expect(search?.headers.authorization).toBe('Bearer ghp_e2e');
  expect(search?.body).toMatchObject({
    variables: { query: 'is:pr is:open author:@me archived:false sort:updated-desc' },
  });

  const { snapshot, pollState } = await stored(serviceWorker);
  expect(snapshot).toMatchObject({
    viewer: { login: 'octocat' },
    sections: { authored: [prId(1)] },
    sectionErrors: {},
  });
  expect(snapshot?.pullRequests[prId(1)]).toMatchObject({
    title: 'Improve widget 1',
    checks: { state: 'success' },
  });
  expect(pollState).toMatchObject({
    lastSuccessAt: snapshot?.fetchedAt,
    consecutiveFailures: 0,
    lastError: null,
    inFlight: false,
    rateLimit: { remaining: 4990 },
  });
  expect(await pollAlarm(serviceWorker)).toMatchObject({ periodInMinutes: 2 });
});

test('waits for the rate limit to reset, even for a forced poll', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  const reset = Math.floor(Date.now() / 1000) + 20 * 60;
  github.onGraphQL('ProwlSearch', () => ({
    status: 403,
    headers: rateLimitHeaders({ remaining: 0, reset }),
    body: { message: 'API rate limit exceeded for user ID 1.' },
  }));
  await signIn();
  await poll();
  expect((await stored(serviceWorker)).pollState).toMatchObject({
    nextAllowedAt: new Date(reset * 1000).toISOString(),
    consecutiveFailures: 1,
    lastError: { kind: 'rate_limited' },
    inFlight: false,
  });

  await poll();
  expect(github.requestsFor('ProwlSearch')).toHaveLength(1);
});

test('a rejected token stops polling, and sign-out clears the poll state', async ({
  github,
  signIn,
  poll,
  openPanel,
  serviceWorker,
}) => {
  github.onGraphQL('ProwlSearch', () => ({ status: 401, body: { message: 'Bad credentials' } }));
  await signIn();
  await poll();
  expect((await stored(serviceWorker)).pollState).toMatchObject({
    nextAllowedAt: null,
    lastError: { kind: 'unauthorized', message: 'Bad credentials' },
  });
  expect(await pollAlarm(serviceWorker)).toBeNull();

  const panel = await openPanel();
  await serviceWorker.evaluate(() => chrome.storage.local.remove(['auth', 'snapshot']));
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'signedOut' }));
  expect(await stored(serviceWorker)).toEqual({});
});
