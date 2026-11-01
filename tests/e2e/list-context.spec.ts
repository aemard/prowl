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
  await expect(reopened.getByRole('note')).toContainText('3 loaded');
  await expectNoA11yViolations(reopened);
});

test('an all-hidden list explains counts and lets a PR bypass automatic hiding', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  const pr = prNode({
    isDraft: true,
    url: `${MOCK_ORIGIN}/acme/widgets/pull/1`,
    title: 'Hidden draft',
    commits: headCommit({ FAILURE: 1 }),
  });
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([pr], variables));
  await seedStorage({ settings: { ...defaultSettings(), hideDrafts: true } });
  await signIn();
  await poll();
  const panel = await openPanel();
  await expect(
    panel.getByRole('heading', { name: 'All loaded pull requests are set aside' }),
  ).toBeVisible();
  await expect(panel.getByRole('note')).toContainText(
    '1 loaded · 0 in list · 1 hidden · 0 snoozed',
  );
  await expectNoA11yViolations(panel);
  await panel.getByRole('button', { name: 'Show hidden and snoozed' }).click();
  await expect(panel.getByRole('button', { name: 'Hide again' })).toBeFocused();
  await panel.getByRole('button', { name: 'More actions for Hidden draft' }).click();
  await expectNoA11yViolations(panel);
  await panel.getByRole('menuitemcheckbox', { name: 'Always show this PR' }).click();
  await expect(
    panel
      .getByRole('list', { name: 'Created by me pull requests' })
      .getByRole('link', { name: /^Hidden draft/ }),
  ).toBeVisible();
  await expect(panel.getByRole('note')).toContainText(
    '1 loaded · 1 in list · 0 hidden · 0 snoozed',
  );
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
