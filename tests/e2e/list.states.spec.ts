import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { allSections, tabNames } from './helpers/listAssertions';
import { nodesFor } from './helpers/listData';

test('other states › shows a skeleton until the first poll has produced a snapshot', async ({
  github,
  openPanel,
  seedStorage,
  signIn,
  expectNoA11yViolations,
}) => {
  // The worker's install-time poll can start once `auth` is stored: keep any poll in flight
  // (GitHub never answers the search) so it cannot end the skeleton before the checks below.
  github.onGraphQL('ProwlSearch', () => new Promise<never>(() => undefined));
  await signIn();
  await seedStorage({
    pollState: {
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextAllowedAt: null,
      consecutiveFailures: 0,
      rateLimit: null,
      lastError: null,
      inFlight: true,
    },
  });
  const panel = await openPanel();
  await expect(panel.getByRole('status', { name: 'Loading pull requests' })).toBeVisible();
  await expectNoA11yViolations(panel);
});

test('other states › explains an empty section, and a list with no sections turned on', async ({
  github,
  openPanel,
  seedStorage,
  signIn,
  poll,
  expectNoA11yViolations,
}) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([], variables));
  await signIn();
  await poll();
  const panel = await openPanel();
  await expect(panel.getByRole('heading', { name: 'No pull requests' })).toBeVisible();
  await expect(panel.getByText('Pull requests you open will show up here.')).toBeVisible();
  await expect(panel.getByRole('tablist')).toHaveCount(0);
  await expectNoA11yViolations(panel);

  const off = defaultSettings().sections.map((section) => ({ ...section, enabled: false }));
  await seedStorage({ settings: { groupByRepo: false, sections: off } });
  await expect(panel.getByRole('heading', { name: 'No sections turned on' })).toBeVisible();
  await expectNoA11yViolations(panel);
  await panel.getByRole('button', { name: 'Open settings' }).click();
  await expect(panel.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('other states › shows why a section failed to load next to the ones that did', async ({
  github,
  openPanel,
  seedStorage,
  signIn,
  poll,
  expectNoA11yViolations,
}) => {
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(nodesFor(variables.query), variables),
  );
  const custom: Section = {
    id: 'custom-1',
    kind: 'custom',
    label: 'Stale',
    enabled: true,
    query: 'is:issue stale',
  };
  await seedStorage({
    settings: { groupByRepo: false, sections: [...allSections().slice(0, 1), custom] },
  });
  await signIn();
  await poll();

  const panel = await openPanel();
  expect(await tabNames(panel)).toEqual(['Mine7', 'StaleCould not load']);
  await panel.getByRole('tab', { name: /Stale/ }).click();
  await expect(panel.getByText(/Could not load “Stale”/)).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'No pull requests' })).toHaveCount(0);
  await expectNoA11yViolations(panel);
});
