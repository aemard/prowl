import type { Snapshot } from '../../src/lib/model';
import { prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { MOCK_ORIGIN } from './mock-github/server';

test('applies a scope change made while the current search is blocked', async ({
  github,
  signIn,
  poll,
  openPanel,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const review = prNode({
    number: 2,
    title: 'A review from the latest configuration',
    url: `${MOCK_ORIGIN}/acme/widgets/pull/2`,
  });
  github.onGraphQL('ProwlSearch', async (variables) => {
    if (!held) {
      held = true;
      await gate;
    }
    return searchResponse(
      String(variables.query).includes('user-review-requested') ? [review] : [prNode()],
      variables,
    );
  });
  await signIn();
  await serviceWorker.evaluate(() => {
    Object.assign(globalThis, { trailingRequested: false });
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'poll' && message.afterCurrent)
        Object.assign(globalThis, { trailingRequested: true });
    });
  });
  const refreshing = poll();
  try {
    await expect.poll(() => github.requestsFor('ProwlSearch').length).toBe(1);
    const panel = await openPanel('#/settings');
    await panel.getByRole('switch', { name: 'Review requested', exact: true }).click();
    await expect(
      panel.getByRole('switch', { name: 'Review requested', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(() =>
        serviceWorker.evaluate(
          () => (globalThis as unknown as { trailingRequested: boolean }).trailingRequested,
        ),
      )
      .toBe(true);
    release();
    await expect
      .poll(() =>
        serviceWorker.evaluate(
          async () =>
            (await chrome.storage.local.get<{ snapshot: Snapshot }>('snapshot')).snapshot?.sections
              .review_requested?.length,
        ),
      )
      .toBe(1);
    await panel.evaluate(() => {
      location.hash = '#/';
    });
    await panel.getByRole('tab', { name: /^Review/ }).click();
    await expect(
      panel.getByRole('link', { name: /A review from the latest configuration/ }),
    ).toBeVisible();
    await expectNoA11yViolations(panel);
  } finally {
    release();
    await refreshing;
  }
});
