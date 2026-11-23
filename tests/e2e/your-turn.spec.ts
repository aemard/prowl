import { defaultSettings } from '../../src/lib/storage/settings';
import { headCommit, prNode, requestedReviewer, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';

const bob = {
  __typename: 'User',
  login: 'bob',
  avatarUrl: 'https://avatars.githubusercontent.com/bob',
};

test('the Your turn section lists what waits on you, with why, and matches the badge', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      String(variables.query).includes('review-requested')
        ? [
            prNode({
              number: 7,
              title: 'Asks for my review',
              author: bob,
              // Waiting longer than the red build: listed after it (newest turn first).
              commits: headCommit({ SUCCESS: 1 }, {}, '2026-09-01T12:00:00Z'),
              reviewRequests: { nodes: [requestedReviewer('octocat')] },
            }),
          ]
        : [
            prNode({ number: 1, title: 'My red build', commits: headCommit({ FAILURE: 1 }) }),
            prNode({ number: 2, title: 'Waiting on reviewers' }),
          ],
      variables,
    ),
  );
  const on = ['authored', 'review_requested', 'your_turn'];
  await seedStorage({
    settings: {
      groupByRepo: false,
      sections: defaultSettings().sections.map((s) => ({ ...s, enabled: on.includes(s.id) })),
    },
  });
  await signIn();
  await poll();
  const panel = await openPanel();
  const tab = panel.getByRole('tab', { name: /^Your turn/ });
  await expect(tab).toHaveText('Your turn2');
  await tab.click();
  await expect(panel.locator('.pr-card__title')).toHaveText(['My red build', 'Asks for my review']);
  await expect(
    panel.locator('.pr-card__chips').getByText('Your turn: Review', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('Your turn: Fix CI · 1 failing', { exact: true })).toBeVisible();
  await expectNoA11yViolations(panel);
  expect(await serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe('2');
});
