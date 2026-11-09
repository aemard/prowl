import type { Snapshot } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { prNode, requestedTeam, searchResponse, teamJson, userTeamsPage } from '../fixtures/github';
import { expect, test } from './fixtures';
import { MOCK_ORIGIN } from './mock-github/server';

const keys = Array.from({ length: 15 }, (_, i) => `acme/t${i}`);
const teams = keys.map((key) => teamJson(key));
const requested = (number: number, requestedKeys: string[]) =>
  prNode({
    number,
    title: `Team request ${number}`,
    url: `${MOCK_ORIGIN}/acme/widgets/pull/${number}`,
    reviewRequests: {
      nodes: requestedKeys.map(requestedTeam),
      totalCount: requestedKeys.length,
      pageInfo: { hasNextPage: false },
    },
  });
const settings = {
  ...defaultSettings(),
  sections: defaultSettings().sections.map((s) => ({
    ...s,
    enabled: s.kind === 'team_review_requested',
  })),
  unfollowedTeams: ['acme/t0'],
};

test('off teams are filtered before the limit and teams beyond ten are included', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  const nodes = [
    requested(1, ['acme/t0']),
    requested(2, ['acme/t0', 'acme/t14']),
    requested(3, ['acme/t14']),
  ];
  github.on('GET', '/user/teams', ({ path }) => ({ body: userTeamsPage(teams, path) }));
  github.onGraphQL('ProwlSearch', (v) => searchResponse(nodes, v));
  await seedStorage({ settings: { ...settings, maxPerSection: 2 } });
  await signIn();
  await poll();
  const panel = await openPanel();
  await expect(panel.getByRole('link', { name: 'Team request 1' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Team request 2' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Team request 3' })).toBeVisible();
  const stored = await serviceWorker.evaluate(
    async () => (await chrome.storage.local.get('snapshot')).snapshot as Snapshot,
  );
  expect(stored.sections.team_review_requested).toEqual([nodes[1]?.id, nodes[2]?.id]);
  await expectNoA11yViolations(panel);
});

test('permission refusal retries the shared query and keeps results without chips', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  const nodes = [requested(1, ['acme/t0'])];
  github.on('GET', '/user/teams', ({ path }) => ({ body: userTeamsPage(teams, path) }));
  github.onGraphQL('ProwlSearch', (v, request) => {
    const query = (request.body as { query: string }).query;
    return query.includes('... on Team')
      ? { status: 403, body: { message: 'Resource not accessible' } }
      : searchResponse(nodes, v);
  });
  await seedStorage({ settings });
  await signIn();
  await poll();
  const panel = await openPanel();
  await expect(panel.getByRole('link', { name: 'Team request 1' })).toBeVisible();
  await expect(panel.getByTitle(/Review requested from @/)).toHaveCount(0);
  await expectNoA11yViolations(panel);
});
