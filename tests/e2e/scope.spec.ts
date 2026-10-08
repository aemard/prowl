import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { nodesResponse, prNode, searchResponse, teamJson } from '../fixtures/github';
import { expect, test } from './fixtures';

test('every scope preset, a custom search and the repo filters reach GitHub’s search', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
}) => {
  const queries: string[] = [];
  github.onGraphQL('ProwlSearch', (variables) => {
    queries.push(String(variables.query));
    // Every section finds the same two PRs; one is in an excluded repository.
    return searchResponse(
      [
        prNode({ number: 1, repository: 'acme/web' }),
        prNode({ number: 2, repository: 'acme/legacy' }),
      ],
      variables,
    );
  });
  github.onGraphQL('ProwlNodes', (variables) => nodesResponse(variables.ids, []));
  github.on('GET', '/user/teams', () => ({ body: [teamJson('acme/core', 'Core')] }));
  const sections: Section[] = [
    ...defaultSettings().sections.map((s) => ({ ...s, enabled: true })),
    { id: 'bugs', kind: 'custom', label: 'Bugs', enabled: true, query: 'label:bug org:acme' },
  ];
  await seedStorage({
    settings: { sections, repoInclude: ['acme'], repoExclude: ['acme/legacy'] },
  });
  await signIn();
  await poll();

  const has = (qualifier: string) => queries.filter((q) => q.includes(qualifier));
  expect(has('author:@me')).toHaveLength(1);
  expect(has('user-review-requested:@me')).toHaveLength(1);
  expect(has('team-review-requested:acme/core')).toHaveLength(1);
  expect(has('mentions:@me')).toHaveLength(1);
  expect(has('assignee:@me')).toHaveLength(1);
  expect(has('label:bug')).toHaveLength(1);
  for (const query of queries) {
    expect(query).toMatch(/\bis:pr\b/);
    expect(query).toContain('-repo:acme/legacy');
  }
  // Presets get the include list; the custom search keeps its own scope.
  expect(queries.filter((q) => q.includes('user:acme'))).toHaveLength(5);

  // The excluded repository is filtered out client-side too. Six sections: four tabs and More.
  const panel = await openPanel();
  await expect(panel.getByRole('tab')).toHaveCount(4);
  const repos = panel.locator('.pr-card__repo-name');
  await expect(repos).toHaveText(['acme/web']);
});
