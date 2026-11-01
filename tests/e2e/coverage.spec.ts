import { prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';

for (const count of [50, 51]) {
  test(`explains coverage only when more results exist (${count} PRs)`, async ({
    github,
    seedStorage,
    signIn,
    poll,
    openPanel,
    expectNoA11yViolations,
  }) => {
    const nodes = Array.from({ length: count }, (_, index) =>
      prNode({
        number: index + 1,
        isDraft: index < 50,
      }),
    );
    github.onGraphQL('ProwlSearch', (variables) => searchResponse(nodes, variables));
    await seedStorage({ settings: { hideDrafts: true } });
    await signIn();
    await poll();
    const panel = await openPanel();
    const coverage = panel.getByLabel('List coverage');
    if (count === 50) {
      await expect(coverage).toHaveCount(0);
    } else {
      await expect(coverage).toContainText('50 PRs loaded. More results are available on GitHub.');
      await expect(coverage.getByRole('link', { name: 'View on GitHub' })).toBeVisible();
      await expect(coverage.getByRole('button', { name: 'Change limit' })).toBeVisible();
      await panel.getByRole('searchbox').fill('unloaded-result');
      await expect(panel.getByText(/This search only covers the loaded PRs/)).toBeVisible();
      await coverage.getByRole('button', { name: 'Change limit' }).click();
      await expect(panel.getByLabel('Maximum PRs loaded per section')).toBeFocused();
    }
    await expectNoA11yViolations(panel);
  });
}
