import type { Locator, Page } from '@playwright/test';
import {
  checkRunNode,
  detailNode,
  detailResponse,
  headCommit,
  prId,
  searchResponse,
} from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { mockDetail } from './helpers/detailData';
import { nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

const DETAIL = 'ProwlPullRequestDetail';
const CHECKOUT = prId(2481, 'acme/web');

const card = (panel: Page, title: RegExp) =>
  panel.locator('.pr-card', { has: panel.getByRole('link', { name: title }) });
const toggle = (cardLocator: Locator) => cardLocator.getByRole('button', { name: /^Details for / });
const texts = (list: Locator) => list.getByRole('listitem').allTextContents();

test.describe('expanding a card', () => {
  test.beforeEach(async ({ context, github, signIn, poll }) => {
    github.onGraphQL('ProwlSearch', (variables) =>
      searchResponse(nodesFor(variables.query), variables),
    );
    mockDetail(github);
    await signIn();
    await poll();
    // `poll()` leaves the page it sent from open, and it would mark cards seen like a panel.
    for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
  });

  test('shows why it is blocked, failed checks first with links, and who reviewed', async ({
    context,
    github,
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    const checkout = card(panel, /^Refactor checkout flow/);
    await expect(toggle(checkout)).toHaveAttribute('aria-expanded', 'false');
    // Lazy: nothing is fetched until a card is expanded.
    expect(github.requestsFor(DETAIL)).toHaveLength(0);

    await toggle(checkout).click();
    await expect(toggle(checkout)).toHaveAttribute('aria-expanded', 'true');
    const checks = checkout.getByRole('list', { name: 'Checks' });
    await expect(checks).toBeVisible();
    expect(github.requestsFor(DETAIL)).toHaveLength(1);
    expect(github.requestsFor(DETAIL)[0]?.body).toMatchObject({ variables: { id: CHECKOUT } });

    expect(await texts(checkout.getByRole('list', { name: 'Merge' }))).toEqual([
      'Blocked: changes requested by alice',
      'Blocked: 1 required check failing',
      'Blocked: 4 conversations to resolve',
    ]);
    // What failed is in view, first, with its link; what passed is folded away.
    expect(await texts(checks)).toEqual(['buildRequiredFailed', 'e2e (chromium)Failed']);
    const folded = checkout.locator('details');
    await expect(folded.locator('summary')).toHaveText('11 passed, 1 skipped');
    await expect(folded.getByRole('listitem').first()).toBeHidden();
    await folded.locator('summary').click();
    await expect(folded.getByRole('listitem')).toHaveCount(12);
    await folded.locator('summary').click();

    expect(await texts(checkout.getByRole('list', { name: 'Reviewers' }))).toEqual([
      'aliceChanges requested',
      'carolReview requested',
      'bobApproved',
    ]);
    await expect(checkout.getByRole('list', { name: 'Reviewers' }).locator('img')).toHaveCount(3);

    // A check opens on GitHub in a new tab; a third-party CI link is plain text.
    const opened = context.waitForEvent('page');
    await checks.getByRole('link', { name: 'build' }).click();
    expect((await opened).url()).toBe(`${MOCK_ORIGIN}/acme/web/actions/runs/1/job/build`);
    await folded.locator('summary').click();
    await expect(folded.getByText('ci/legacy-deploy')).toBeVisible();
    await expect(checkout.getByRole('link', { name: 'ci/legacy-deploy' })).toHaveCount(0);
    await folded.locator('summary').click();

    await expectNoA11yViolations(panel);
    await checkout.scrollIntoViewIfNeeded();
    await panel.emulateMedia({ colorScheme: 'light' });
    await saveScreenshot(panel, 'detail');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
    await panel.screenshot({ path: test.info().outputPath('detail-dark.png') });
  });

  test('says "Blocked: 1 approval required" and "Conflicts with main", or "Ready to merge"', async ({
    openPanel,
  }) => {
    const panel = await openPanel();
    const conflicts = card(panel, /^Fix crash when rotating/);
    await toggle(conflicts).click();
    await expect(conflicts.getByRole('list', { name: 'Reviewers' })).toBeVisible();
    expect(await texts(conflicts.getByRole('list', { name: 'Merge' }))).toEqual([
      'Blocked: 1 approval required',
      'Conflicts with main',
    ]);
    expect(await texts(conflicts.getByRole('list', { name: 'Reviewers' }))).toEqual([
      'aliceReview requested',
      'erinReview requested',
    ]);

    const ready = card(panel, /^Add rate limiting/);
    await toggle(ready).click();
    await expect(ready.getByRole('list', { name: 'Reviewers' })).toBeVisible();
    expect(await texts(ready.getByRole('list', { name: 'Merge' }))).toEqual(['Ready to merge']);
    // The two stay open side by side.
    await expect(panel.locator('.pr-detail')).toHaveCount(2);
  });

  test('stays expanded across refreshes, refetching only when the PR changed', async ({
    github,
    openPanel,
  }) => {
    const panel = await openPanel();
    const checkout = card(panel, /^Refactor checkout flow/);
    await toggle(checkout).click();
    await expect(checkout.getByRole('list', { name: 'Checks' })).toBeVisible();
    await toggle(checkout).click();
    await toggle(checkout).click();
    await expect(checkout.getByRole('list', { name: 'Checks' })).toBeVisible();
    // Collapsing and expanding again reuses what was loaded.
    expect(github.requestsFor(DETAIL)).toHaveLength(1);

    // A poll that changes nothing the detail depends on: still open, nothing refetched.
    const refresh = () =>
      panel.evaluate(() => chrome.runtime.sendMessage({ type: 'poll', force: true }));
    await refresh();
    await expect(panel.locator('.pr-card__summary').first()).toBeVisible();
    await expect(toggle(checkout)).toHaveAttribute('aria-expanded', 'true');
    expect(github.requestsFor(DETAIL)).toHaveLength(1);

    // CI goes green on the PR: the next poll brings new counts and the open card follows.
    github
      .onGraphQL('ProwlSearch', (variables) =>
        searchResponse(
          nodesFor(variables.query).map((node) =>
            node.id === CHECKOUT
              ? {
                  ...node,
                  updatedAt: new Date().toISOString(),
                  commits: headCommit({ SUCCESS: 14 }),
                }
              : node,
          ),
          variables,
        ),
      )
      .onGraphQL(DETAIL, () =>
        detailResponse(detailNode({ checks: [checkRunNode('build'), checkRunNode('lint')] })),
      );
    await refresh();
    await expect(toggle(checkout)).toHaveAttribute('aria-expanded', 'true');
    await expect(checkout.getByRole('list', { name: 'Checks' })).toHaveCount(0);
    await expect(checkout.locator('summary')).toHaveText('2 passed');
    expect(github.requestsFor(DETAIL)).toHaveLength(2);
  });

  test('works from the keyboard: Enter opens, Escape closes and focus stays on the card', async ({
    openPanel,
  }) => {
    const panel = await openPanel();
    const checkout = card(panel, /^Refactor checkout flow/);
    const button = toggle(checkout);
    await button.focus();
    await panel.keyboard.press('Enter');
    await expect(checkout.getByRole('list', { name: 'Checks' })).toBeVisible();
    await expect(button).toBeFocused();

    // Tab: the title link, then into the details (the actions, then the first failed check).
    await panel.keyboard.press('Tab');
    await expect(checkout.getByRole('link', { name: /^Refactor checkout flow/ })).toBeFocused();
    await panel.keyboard.press('Tab');
    await expect(checkout.getByRole('button', { name: /^Comment on / })).toBeFocused();
    await panel.keyboard.press('Tab');
    await expect(checkout.getByRole('button', { name: /^Merge / })).toBeFocused();
    await panel.keyboard.press('Tab');
    await expect(checkout.getByRole('button', { name: /^Re-run failed checks of / })).toBeFocused();
    await panel.keyboard.press('Tab');
    await expect(checkout.getByRole('button', { name: /^Convert to draft: / })).toBeFocused();
    await panel.keyboard.press('Tab');
    await expect(checkout.getByRole('link', { name: 'build' })).toBeFocused();

    await panel.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.locator('.pr-detail')).toHaveCount(0);
    await expect(button).toBeFocused();

    await panel.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('explains a failed fetch and tries again', async ({
    github,
    openPanel,
    expectNoA11yViolations,
  }) => {
    github.onGraphQL(DETAIL, () => ({
      status: 502,
      body: { message: 'GitHub is having a bad day' },
    }));
    const panel = await openPanel();
    const checkout = card(panel, /^Refactor checkout flow/);
    await toggle(checkout).click();
    await expect(checkout.getByRole('alert')).toContainText('GitHub is having a bad day');
    // The merge facts from the list are there regardless.
    await expect(checkout.getByRole('list', { name: 'Merge' })).toBeVisible();
    await expectNoA11yViolations(panel);

    mockDetail(github);
    await checkout.getByRole('button', { name: 'Try again' }).click();
    await expect(checkout.getByRole('list', { name: 'Checks' })).toBeVisible();
    await expect(checkout.getByRole('alert')).toHaveCount(0);
  });
});
