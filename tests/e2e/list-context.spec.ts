import type { PanelState } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { headCommit, prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

test('reopening restores the section and folded repositories, while clearing search', async ({
  context,
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(nodesFor(variables.query), variables),
  );
  const settings = defaultSettings();
  settings.sections = settings.sections.map((section) => ({
    ...section,
    enabled: ['authored', 'review_requested'].includes(section.id),
  }));
  await seedStorage({ settings });
  await signIn();
  await poll();
  for (const page of context.pages()) await page.close();
  const panel = await openPanel();
  await panel.getByRole('tab', { name: /^Review/ }).click();
  const group = panel.getByRole('button', { name: /^acme\/web 1 pull request/ });
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await panel.getByRole('searchbox').fill('keyboard');
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () =>
          (await chrome.storage.local.get<{ panelState?: PanelState }>('panelState')).panelState
            ?.foldedGroups,
      ),
    )
    .toEqual(['review_requested\nacme/web']);
  await panel.close();
  const reopened = await openPanel();
  await reopened.setViewportSize({ width: 320, height: 760 });
  await expect(reopened.getByRole('tab', { name: /^Review/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(reopened.getByRole('button', { name: /^acme\/web 1 pull request/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(reopened.getByRole('searchbox')).toHaveValue('');
  await expect(reopened.getByRole('note')).toHaveCount(0);
  await expectNoA11yViolations(reopened);
});

test('an all-snoozed list opens its single fold and can unsnooze a PR', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  const pr = prNode({
    isDraft: true,
    title: 'Snoozed draft',
    url: `${MOCK_ORIGIN}/acme/widgets/pull/1`,
    commits: headCommit({ FAILURE: 1 }),
  });
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([pr], variables));
  await signIn();
  await seedStorage({
    prLocal: {
      snoozed: { [pr.id]: new Date(Date.now() + 3_600_000).toISOString() },
      muted: {},
      seen: {},
    },
  });
  await poll();
  const panel = await openPanel();
  await expect(
    panel.getByRole('heading', { name: 'All loaded pull requests are snoozed' }),
  ).toBeVisible();
  await expect(panel.getByText('They return here when the snooze ends.')).toBeVisible();
  await expect(panel.getByRole('note')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Show snoozed', exact: true }).click();
  const fold = panel.getByRole('button', { name: 'Snoozed (1)' });
  await expect(fold).toBeFocused();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByTitle(/^Snoozed until /)).toBeVisible();
  await panel.getByRole('button', { name: 'More actions for Snoozed draft' }).click();
  await expect(panel.getByRole('menuitemcheckbox', { name: 'Always show this PR' })).toHaveCount(0);
  await panel.getByRole('menuitem', { name: 'Unsnooze', exact: true }).click();
  await expect(
    panel
      .getByRole('list', { name: 'Created by me pull requests' })
      .getByRole('link', { name: /^Snoozed draft/ }),
  ).toBeVisible();
  await expect(fold).toHaveCount(0);
  await expectNoA11yViolations(panel);
});

test('a changed check becomes unseen without changing the PR activity date', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  const pr = prNode({ title: 'Observe checks', url: `${MOCK_ORIGIN}/acme/widgets/pull/1` });
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([pr], variables));
  await seedStorage({ settings: { ...defaultSettings(), hideStaleAfterDays: 0 } });
  await signIn();
  await poll();
  const panel = await openPanel();
  const card = panel.locator('.pr-card__summary');
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('data-unseen', 'true', { timeout: 6000 });
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse([{ ...pr, commits: headCommit({ FAILURE: 1 }) }], variables),
  );
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'poll', force: true }));
  await expect(card).toHaveAttribute('data-unseen', 'true');
  await expect(card.locator('time').first()).toHaveAttribute('datetime', pr.updatedAt);
  await expectNoA11yViolations(panel);
});
