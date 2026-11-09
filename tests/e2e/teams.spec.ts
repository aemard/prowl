/** Team review requests (US-037): team discovery, one search for all teams, and the section. */
import type { Page, Worker } from '@playwright/test';
import type { Snapshot, TeamsState } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import {
  headCommit,
  prNode,
  requestedTeam,
  searchResponse,
  teamJson,
  userTeamsPage,
} from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { MOCK_ORIGIN, type MockGitHub } from './mock-github/server';

const node = (number: number, title: string, overrides: Parameters<typeof prNode>[0] = {}) =>
  prNode({ number, title, url: `${MOCK_ORIGIN}/acme/widgets/pull/${number}`, ...overrides });

/** Asked of acme/core; failing CI, so it needs attention. */
const failing = node(1, 'Fix the flaky login test', {
  reviewRequests: {
    nodes: [requestedTeam('acme/core')],
    totalCount: 1,
    pageInfo: { hasNextPage: false },
  },
  updatedAt: '2026-10-07T09:00:00Z',
  commits: headCommit({ SUCCESS: 1, FAILURE: 1 }),
});
/** Asked of both teams. */
const shared = node(2, 'Share the button styles', {
  updatedAt: '2026-10-07T08:00:00Z',
  reviewRequests: {
    nodes: [requestedTeam('acme/core'), requestedTeam('acme/web')],
    totalCount: 2,
    pageInfo: { hasNextPage: false },
  },
});
/** Asked of acme/web; a visible draft with failing CI. */
const draft = node(3, 'New page header', {
  reviewRequests: {
    nodes: [requestedTeam('acme/web')],
    totalCount: 1,
    pageInfo: { hasNextPage: false },
  },
  isDraft: true,
  updatedAt: '2026-10-07T07:00:00Z',
  commits: headCommit({ FAILURE: 1 }),
});
/** Asked of the viewer directly. */
const direct = node(4, 'Bump the API client', { updatedAt: '2026-10-07T06:00:00Z' });

const TEAMS = [teamJson('acme/web', 'Web'), teamJson('acme/core', 'Core')];

const SETTINGS = {
  sections: defaultSettings().sections.map((section) => ({
    ...section,
    enabled: section.kind === 'review_requested' || section.kind === 'team_review_requested',
  })),
};

function serveSearches(github: MockGitHub) {
  github.onGraphQL('ProwlSearch', (variables) => {
    const query = String(variables.query);
    const nodes = query.includes('team-review-requested-user:@me ')
      ? [failing, shared, draft]
      : query.includes('user-review-requested:@me ')
        ? [direct]
        : [];
    return searchResponse(nodes, variables);
  });
}

const serveTeams = (github: MockGitHub) =>
  github.on('GET', '/user/teams', ({ path }) => ({ body: userTeamsPage(TEAMS, path) }));

const stored = (worker: Worker) =>
  worker.evaluate(
    () =>
      chrome.storage.local.get(['teams', 'snapshot', 'pollState']) as Promise<{
        teams?: TeamsState;
        snapshot?: Snapshot;
        pollState?: { lastError: unknown };
      }>,
  );
/** Ids of the cards shown, in order. */
const cards = (panel: Page) =>
  panel
    .locator('.pr-list .pr-card__summary')
    .evaluateAll((summaries) => summaries.map((summary) => (summary as HTMLElement).dataset.prId));

test('finds the teams and lists what they are asked to review in Team reviews', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  serveTeams(github);
  serveSearches(github);
  await seedStorage({ settings: SETTINGS });
  await signIn();
  await poll();

  const searches = github
    .requestsFor('ProwlSearch')
    .map((request) => (request.body as { variables: { query: string } }).variables.query);
  expect(searches).toEqual([
    'is:pr is:open user-review-requested:@me archived:false sort:updated-desc',
    'is:pr is:open team-review-requested-user:@me archived:false sort:updated-desc',
  ]);
  const { teams, snapshot } = await stored(serviceWorker);
  expect(teams).toMatchObject({
    login: 'octocat',
    teams: [
      { org: 'acme', slug: 'core', name: '@acme/core' },
      { org: 'acme', slug: 'web', name: '@acme/web' },
    ],
    error: null,
  });
  expect(snapshot?.sections.team_review_requested).toEqual([failing.id, shared.id, draft.id]);
  expect(snapshot?.teamRequests?.[shared.id]).toEqual(['acme/core', 'acme/web']);

  const panel = await openPanel();
  // Drafts count like every unsnoozed loaded PR.
  await expect(panel.getByRole('tab')).toHaveText(['Review1', 'Teams3']);
  await expect(panel.getByRole('tab', { name: /^Teams/ })).toHaveAttribute('title', 'Team reviews');
  await panel.getByRole('tab', { name: /^Teams/ }).click();
  await expect(panel.getByRole('tabpanel', { name: 'Team reviews' })).toBeVisible();
  await expect.poll(() => cards(panel)).toEqual([failing.id, shared.id, draft.id]);
  await expect(panel.locator('.team-picker')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Edit teams' })).toHaveCount(0);
  // The badge includes the failing draft too.
  await expect.poll(() => serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe('2');
  // Each card says which of the viewer's teams is asked, in the chip and to a screen reader.
  const sharedCard = panel.locator(`[data-pr-id="${shared.id}"]`);
  await expect(sharedCard.getByTitle('Review requested from @acme/core, @acme/web')).toHaveText(
    '@acme/core, @acme/web',
  );
  await expect(
    panel.getByRole('button', { name: 'Details for Share the button styles' }),
  ).toHaveAccessibleDescription(/Review requested from @acme\/core, @acme\/web/);
  await panel.emulateMedia({ colorScheme: 'light' });
  await expectNoA11yViolations(panel);
  await panel.mouse.move(0, 0);
  await saveScreenshot(panel, 'list-teams');
});

test('follows and unfollows teams from Settings, which filters the results', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  serveTeams(github);
  serveSearches(github);
  await seedStorage({ settings: SETTINGS });
  await signIn();
  await poll();

  const panel = await openPanel('#/settings');
  const teams = panel.locator('.team-picker');
  await expect(teams.getByRole('group', { name: 'acme' })).toBeVisible();
  await expect(teams.getByRole('switch', { name: '@acme/core' })).toBeChecked();
  await expect(teams.getByText(/Checked just now/)).toHaveCount(0);
  await panel.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(panel);

  const before = github.requestsFor('ProwlSearch').length;
  await teams.getByRole('switch', { name: '@acme/web' }).click();
  await expect(teams.getByRole('switch', { name: '@acme/web' })).not.toBeChecked();
  // The query stays the same; the background excludes web-only requests.
  await expect
    .poll(() =>
      github
        .requestsFor('ProwlSearch')
        .slice(before)
        .map((request) => (request.body as { variables: { query: string } }).variables.query)
        .filter((query) => query.includes('team-review-requested')),
    )
    .toEqual(['is:pr is:open team-review-requested-user:@me archived:false sort:updated-desc']);

  const discoveries = () => github.requests.filter((r) => r.path.startsWith('/user/teams')).length;
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();
  await panel.getByRole('tab', { name: /^Teams/ }).click();
  await expect.poll(() => cards(panel)).toEqual([failing.id, shared.id]);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const listed = discoveries();
  await teams.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(discoveries).toBeGreaterThan(listed);
});

test('explains a missing read:org scope only in Settings, then finds the teams on request', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  serviceWorker,
}) => {
  github.on('GET', '/user/teams', () => ({
    status: 403,
    body: { message: 'Resource not accessible by personal access token' },
  }));
  serveSearches(github);
  await seedStorage({ settings: SETTINGS });
  await signIn({ scopes: ['repo'] });
  await poll();

  const before = await stored(serviceWorker);
  expect(before.teams?.error?.kind).toBe('missing_scope');
  expect(before.pollState?.lastError).toBeNull();
  const settings = await openPanel('#/settings');
  const group = settings.locator('.team-picker');
  await expect(group.getByText(/Prowl can't see your teams/)).toBeVisible();
  await expect(group.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  await settings.close();

  const panel = await openPanel();
  await panel.getByRole('tab', { name: /^Teams/ }).click();
  await expect(panel.getByText(/Prowl can't see your teams/)).toHaveCount(0);
  await expect.poll(() => cards(panel)).toEqual([failing.id, shared.id, draft.id]);

  // The token got the permission on GitHub: a refresh from the panel finds the teams now.
  serveTeams(github);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'refreshTeams' }));
  await expect(panel.getByText(/Could not load “Team reviews”/)).toHaveCount(0);
  await expect.poll(() => cards(panel)).toEqual([failing.id, shared.id, draft.id]);
  expect((await stored(serviceWorker)).teams?.error).toBeNull();
});
