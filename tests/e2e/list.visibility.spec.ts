import { searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import {
  AUTHORED,
  allSections,
  cardFor,
  enableRepositoryGrouping,
  expectRepositoryKeyboardFolding,
  recordMessages,
  stored,
  tabNames,
} from './helpers/listAssertions';
import { nodesFor } from './helpers/listData';

test.describe('with a rich set of pull requests', () => {
  test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
    github.onGraphQL('ProwlSearch', (variables) =>
      searchResponse(nodesFor(variables.query), variables),
    );
    await seedStorage({ settings: { groupByRepo: false, sections: allSections() } });
    await signIn();
    await poll();
    // `poll()` leaves the page it sent from open, and it would mark cards seen like a panel.
    for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
  });

  test('shows old PRs, drafts and bots without automatic hiding controls', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    await expect(panel.getByRole('listitem')).toHaveCount(8);
    expect(await tabNames(panel)).toEqual(['Mine8', 'Review3', 'Mentions1', 'Assigned3']);
    await expect(cardFor(panel, /^Experiment: lazy-load/)).toBeAttached();
    await expect(panel.getByRole('button', { name: /hidden/i })).toHaveCount(0);
    await expect(panel.getByRole('note')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(panel.getByLabel('Hide PRs with no commit for (days)')).toHaveCount(0);
    await expect(
      panel.getByRole('switch', { name: /Hide draft PRs|Hide PRs opened by bots/ }),
    ).toHaveCount(0);
    await expectNoA11yViolations(panel);
  });

  test('groups pull requests by repository with its own switch, and folds a group', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    const headers = panel.locator('.repo-group__heading');
    const header = (repo: string) =>
      panel.getByRole('button', { name: new RegExp(`^${repo} \\d`) });
    const rateLimit = /^Add rate limiting middleware/;
    await expect(headers).toHaveCount(0);

    await enableRepositoryGrouping(panel);

    // One header per repository, in the order of its newest PR; the count of the bar is unchanged.
    await expect(headers).toHaveText([
      'acme/web3 pull requests',
      'acme/api2 pull requests',
      'acme/mobile1 pull request',
      'octo/docs1 pull request',
      'northwind-engineering/internal-platform-services-monorepo1 pull request',
    ]);
    await expect(header('acme/web')).toHaveAttribute('aria-expanded', 'true');
    const web = panel.getByRole('list', { name: 'acme/web pull requests' });
    await expect(web.getByRole('listitem')).toHaveCount(3);
    await expect(web.locator('.pr-card__repo').first()).toHaveText('#2481');
    await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine8');
    // The long name is cut by the strip (full name in the tooltip), never by scrolling sideways.
    const long = header('northwind-engineering/internal-platform-services-monorepo');
    await expect(long.locator('.repo-group__name')).toHaveAttribute(
      'title',
      'northwind-engineering/internal-platform-services-monorepo',
    );
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await expectRepositoryKeyboardFolding(panel, header, rateLimit);

    // The quick filter narrows the groups and their counts; a folded group stays folded.
    const filter = panel.getByRole('searchbox', { name: 'Filter pull requests' });
    await filter.fill('acme/web');
    await expect(headers).toHaveText(['acme/web3 pull requests']);
    await filter.fill('rate limiting');
    await expect(headers).toHaveText(['acme/api1 pull request']);
    await expect(header('acme/api')).toHaveAttribute('aria-expanded', 'false');
    await filter.fill('');
    await expect(headers).toHaveCount(5);

    // Folded state lasts for the session: through Settings and back.
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByRole('button', { name: 'Back to pull requests' }).click();
    await expect(header('acme/api')).toHaveAttribute('aria-expanded', 'false');
    await header('acme/api').click();
    await expect(cardFor(panel, rateLimit)).toBeVisible();

    await panel.emulateMedia({ colorScheme: 'light' });
    await expectNoA11yViolations(panel);
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
  });

  test('does not mark the cards of a folded group as seen', async ({
    openPanel,
    seedStorage,
    serviceWorker,
  }) => {
    await seedStorage({ settings: { sections: allSections(), groupByRepo: true } });
    const messages = await recordMessages(serviceWorker);
    const panel = await openPanel();
    const checkout = panel.locator(`[data-pr-id="${AUTHORED.checkout}"]`);
    const rateLimit = panel.locator(`[data-pr-id="${AUTHORED.rateLimit}"]`);
    await panel.getByRole('button', { name: /^acme\/api \d/ }).click();
    await expect(rateLimit).toHaveCount(0);

    await expect(checkout).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
    const marked = (await messages()).filter((m) => m.type === 'markSeen').flatMap((m) => m.prIds);
    expect(marked).toContain(AUTHORED.checkout);
    expect(marked).not.toContain(AUTHORED.rateLimit);
    expect(marked).not.toContain(AUTHORED.draft);

    // Unfolded, they are on screen and get marked like any card.
    await panel.getByRole('button', { name: /^acme\/api \d/ }).click();
    await expect(rateLimit).toHaveAttribute('data-unseen', 'true');
    // Nothing is hidden any more, so the unfolded group can start below the fold.
    await rateLimit.scrollIntoViewIfNeeded();
    await expect(rateLimit).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
  });

  test('marks the cards on screen as seen after 1.5 s, and the others once scrolled to', async ({
    openPanel,
    serviceWorker,
  }) => {
    const messages = await recordMessages(serviceWorker);
    const panel = await openPanel();
    const checkout = panel.locator(`[data-pr-id="${AUTHORED.checkout}"]`);
    const contrast = panel.locator(`[data-pr-id="${AUTHORED.contrast}"]`);
    await expect(checkout).toHaveAttribute('data-unseen', 'true');
    await expect(contrast).toHaveAttribute('data-unseen', 'true');
    await expect(contrast).not.toBeInViewport();

    await panel.waitForTimeout(800);
    expect((await messages()).filter((m) => m.type === 'markSeen')).toEqual([]);

    await expect(checkout).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
    const [first] = (await messages()).filter((m) => m.type === 'markSeen');
    expect(first?.prIds).toContain(AUTHORED.checkout);
    expect(first?.prIds).not.toContain(AUTHORED.contrast);
    await expect(contrast).toHaveAttribute('data-unseen', 'true');
    const { prLocal } = await stored(serviceWorker);
    expect(Object.keys(prLocal?.seen ?? {})).toContain(AUTHORED.checkout);
    expect(Object.keys(prLocal?.seen ?? {})).not.toContain(AUTHORED.contrast);

    await contrast.scrollIntoViewIfNeeded();
    await expect(contrast).not.toHaveAttribute('data-unseen', 'true', { timeout: 6_000 });
  });

  test('does not mark anything seen while the panel is hidden', async ({
    openPanel,
    serviceWorker,
  }) => {
    const messages = await recordMessages(serviceWorker);
    const panel = await openPanel();
    await panel.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await panel.waitForTimeout(2_200);
    expect((await messages()).filter((m) => m.type === 'markSeen')).toEqual([]);
  });
});
