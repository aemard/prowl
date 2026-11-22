import type { Worker } from '@playwright/test';
import { prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';

const shown = (worker: Worker) =>
  worker.evaluate(async () => Object.keys(await chrome.notifications.getAll()));

/** Someone else's PR asking the viewer for a review, last updated now. */
const asking = (number: number) =>
  prNode({
    number,
    author: { __typename: 'User', login: 'hubot', avatarUrl: '' },
    reviewRequests: { nodes: [{ requestedReviewer: { login: 'octocat' } }] },
    updatedAt: new Date().toISOString(),
  });

test.beforeEach(async ({ seedStorage }) => {
  await seedStorage({ settings: { notifications: { enabled: true } } });
});

test('a review asked on a new pull request notifies once', async ({
  github,
  signIn,
  poll,
  serviceWorker,
}) => {
  const requested: ReturnType<typeof asking>[] = [asking(1)];
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      String(variables.query).includes('user-review-requested:@me') ? requested : [],
      variables,
    ),
  );
  await signIn();
  await poll();
  // The first poll has no baseline: what is already there is not news.
  expect(await shown(serviceWorker)).toEqual([]);

  const fresh = asking(2);
  requested.push(fresh);
  await poll();
  const id = `${fresh.id}:review_requested:${fresh.updatedAt}`;
  expect(await shown(serviceWorker)).toEqual([id]);

  await serviceWorker.evaluate((notification) => chrome.notifications.clear(notification), id);
  await poll();
  expect(await shown(serviceWorker)).toEqual([]);
});
