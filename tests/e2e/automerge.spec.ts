/** Update branch and auto-merge (US-039), from the Actions row of an expanded card. */
import type { Locator, Page } from '@playwright/test';
import { defaultSettings } from '../../src/lib/storage/settings';
import { headCommit, prNode, repositoryNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { mockDetail } from './helpers/detailData';
import { MOCK_ORIGIN } from './mock-github/server';

const node = (number: number, title: string, overrides: Parameters<typeof prNode>[0] = {}) =>
  prNode({ number, title, url: `${MOCK_ORIGIN}/acme/widgets/pull/${number}`, ...overrides });

/** The base moved on since it was opened. */
const behind = node(1, 'Behind its base', { mergeStateStatus: 'BEHIND' });
/** Waits on a review, in a repository that allows auto-merge. */
const waiting = {
  ...node(2, 'Waiting on a review', { commits: headCommit({ SUCCESS: 2 }) }),
  repository: repositoryNode('acme/widgets', { autoMergeAllowed: true }),
};

const SETTINGS = {
  sections: defaultSettings().sections.map((section) => ({
    ...section,
    enabled: section.kind === 'authored',
  })),
};

const toasts = (panel: Page) => panel.getByRole('region', { name: 'Messages' });

async function expand(panel: Page, title: string): Promise<Locator> {
  const card = panel.locator('.pr-card', { has: panel.getByRole('link', { name: title }) });
  await card.getByRole('button', { name: /^Details for / }).click();
  await expect(card.locator('.pr-detail')).toBeVisible();
  return card;
}

test('updates a branch that is behind with a rebase, pinned to its head', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([behind, waiting], variables));
  github.onGraphQL('ProwlUpdateBranch', () => ({
    updatePullRequestBranch: { pullRequest: { headRefOid: 'b'.repeat(40) } },
  }));
  mockDetail(github);
  await seedStorage({ settings: SETTINGS });
  await signIn();
  await poll();

  const panel = await openPanel();
  const card = await expand(panel, 'Behind its base, acme/widgets#1');
  await expectNoA11yViolations(panel);
  await card.getByRole('button', { name: 'Update branch of acme/widgets#1' }).click();
  await expect(panel.getByRole('menuitem', { name: 'Update with a merge commit' })).toBeVisible();
  await panel.getByRole('menuitem', { name: 'Update with a rebase' }).click();
  await expect(toasts(panel)).toContainText('Updated the branch of acme/widgets#1');
  expect(github.requestsFor('ProwlUpdateBranch')[0]?.body).toMatchObject({
    variables: { id: behind.id, oid: behind.headRefOid, method: 'REBASE' },
  });
  // Only a branch that is behind offers it.
  const other = await expand(panel, 'Waiting on a review, acme/widgets#2');
  await expect(other.getByRole('button', { name: /^Update branch/ })).toHaveCount(0);
});

test('turns auto-merge on from the merge dialog, shows it on the card, and off again', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  let autoMerge: { mergeMethod: string; enabledBy: { login: string } } | null = null;
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse([{ ...waiting, autoMergeRequest: autoMerge }], variables),
  );
  github.onGraphQL('ProwlEnableAutoMerge', ({ method }) => {
    autoMerge = { mergeMethod: String(method), enabledBy: { login: 'octocat' } };
    return { enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: autoMerge } } };
  });
  github.onGraphQL('ProwlDisableAutoMerge', () => {
    autoMerge = null;
    return { disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } };
  });
  mockDetail(github);
  await seedStorage({ settings: SETTINGS });
  await signIn();
  await poll();

  const panel = await openPanel();
  const card = await expand(panel, 'Waiting on a review, acme/widgets#2');
  await card.getByRole('button', { name: 'Merge acme/widgets#2' }).click();
  const dialog = panel.getByRole('dialog', { name: 'Merge pull request' });
  await expect(dialog).toContainText('or let GitHub merge it once its checks and reviews pass');
  await dialog.getByRole('combobox', { name: 'Merge method' }).selectOption('squash');
  await expectNoA11yViolations(panel);
  await dialog.getByRole('button', { name: 'Enable auto-merge' }).click();
  await expect(toasts(panel)).toContainText('Auto-merge is on for acme/widgets#2');
  expect(github.requestsFor('ProwlEnableAutoMerge')[0]?.body).toMatchObject({
    variables: { id: waiting.id, method: 'SQUASH', oid: waiting.headRefOid },
  });

  // The forced poll brings the new state: a chip that says so, and the way to turn it off.
  await expect(card.getByTitle('Auto-merge on (squash), by octocat')).toHaveText('Auto-merge');
  await card.getByRole('button', { name: 'Disable auto-merge of acme/widgets#2' }).click();
  await expect(toasts(panel)).toContainText('Auto-merge is off for acme/widgets#2');
  await expect(card.getByTitle(/^Auto-merge on/)).toHaveCount(0);
});
