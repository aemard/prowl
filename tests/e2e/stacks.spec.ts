import { defaultSettings } from '../../src/lib/storage/settings';
import { detailNode, detailResponse, headCommit, prNode, searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';

const TITLES = [
  'Extract the cart model',
  'Add the payment session client',
  'Add the payment session API',
  'Use the payment session in checkout',
  'Migrate saved carts',
  'Checkout analytics events',
];
const stackEntry = (position: number) => ({
  position,
  stack: { id: 'PRS_7', number: 7, size: TITLES.length, baseRefName: 'main' },
});
/** Positions 1-3 ready, 4 failing CI, 5 waiting on reviews, 6 a draft. */
const member = (position: number) =>
  prNode({
    number: 2469 + position,
    title: TITLES[position - 1],
    repository: 'acme/web',
    stackEntry: stackEntry(position),
    ...(position <= 3 ? { mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED' } : {}),
    ...(position === 4 ? { commits: headCommit({ FAILURE: 1, SUCCESS: 6 }) } : {}),
    ...(position === 5 ? { reviewDecision: 'REVIEW_REQUIRED' } : {}),
    ...(position === 6 ? { isDraft: true } : {}),
  });

test('a GitHub stack is one item: counts, members on a rail, and Merge for the ready bottom', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      [
        member(4),
        prNode({ number: 912, title: 'Add rate limiting middleware', repository: 'acme/api' }),
        member(1),
        member(2),
        member(3),
        member(5),
        member(6),
      ],
      variables,
    ),
  );
  // The base branch merges directly (no merge queue) with the repository's methods.
  github.onGraphQL('ProwlPullRequestDetail', () => detailResponse(detailNode()));
  let merged: unknown;
  github.on('PUT', /^\/repos\/acme\/web\/pulls\/2472\/merge-async$/, ({ body }) => {
    merged = body;
    return { status: 202, body: { status: 'merged' } };
  });
  const on = ['authored'];
  await seedStorage({
    settings: {
      groupByRepo: false,
      sections: defaultSettings().sections.map((s) => ({ ...s, enabled: on.includes(s.id) })),
    },
  });
  await signIn();
  await poll();
  const panel = await openPanel();
  const stack = panel.locator('.stack-item');
  await expect(stack).toHaveCount(1);
  await expect(stack.getByText('acme/web · stack #7 · 6 pull requests into main')).toBeVisible();
  await expect(stack.getByRole('button', { name: 'Merge 3 of 6' })).toHaveAccessibleDescription(
    'Merge the 3 ready pull requests at the bottom of stack #7',
  );

  await stack.getByRole('button', { name: 'Show the pull requests of stack #7' }).click();
  await expect(stack.locator('.pr-card')).toHaveCount(6);
  await expectNoA11yViolations(panel);
  await saveScreenshot(panel, 'stack');

  // A member's own card merges only through the stack, up to itself.
  await stack.getByRole('button', { name: 'Details for Add the payment session client' }).click();
  await stack.getByRole('button', { name: 'Merge stack #7 up to acme/web#2471' }).click();
  const upTo = panel.getByRole('dialog', { name: 'Merge 2 pull requests' });
  await expect(upTo).toContainText('The 4 above stay open');
  await upTo.getByRole('button', { name: 'Cancel' }).click();

  await stack.getByRole('button', { name: 'Merge 3 of 6' }).click();
  const dialog = panel.getByRole('dialog', { name: 'Merge 3 pull requests' });
  await expect(dialog).toContainText('The 3 above stay open');
  await expect(dialog.getByRole('combobox', { name: 'Merge method' })).toBeVisible();
  await expectNoA11yViolations(panel);
  await dialog.getByRole('button', { name: 'Merge 3 pull requests' }).click();
  await expect(panel.getByText('Merged acme/web#2472')).toBeVisible();
  expect(merged).toMatchObject({ merge_action: 'direct_merge' });
});
