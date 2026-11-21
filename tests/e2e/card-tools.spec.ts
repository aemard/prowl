import type { Page } from '@playwright/test';
import { defaultSettings } from '../../src/lib/storage/settings';
import { detailNode, detailResponse, prId, searchResponse } from '../fixtures/github';
import { failingRunText, textNode } from '../fixtures/text';
import { threadNode, threadsResponse } from '../fixtures/threads';
import { expect, saveScreenshot, test } from './fixtures';
import { detailsById, mockDetail } from './helpers/detailData';
import { nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

const RATE_LIMIT = prId(912, 'acme/api');

const card = (panel: Page, title: RegExp) =>
  panel.locator('.pr-card', { has: panel.getByRole('link', { name: title }) });
const expand = async (panel: Page, title: RegExp) => {
  const found = card(panel, title);
  await found.getByRole('button', { name: /^Details for / }).click();
  return found;
};

/** Gemini Nano as Chrome exposes it, answering at once, so captures do not need the model. */
function fakeChromeAi() {
  const session = (answer: string) => ({ prompt: async () => answer, destroy: () => {} });
  Object.assign(globalThis, {
    LanguageModel: {
      availability: async () => 'available',
      create: async () =>
        session(
          'The build fails in src/checkout/session.ts:42: createSession now returns a promise, and the reducer still reads it synchronously. Await it in useCheckout, then update the two snapshots.',
        ),
    },
    Summarizer: {
      availability: async () => 'available',
      create: async () => ({
        summarize: async () =>
          '- Moves checkout to the payment session API and drops the legacy cart reducers.\n- Alice asked for the session to be created once per cart, not per render.\n- Still open: the failing build and 4 review conversations.',
        destroy: () => {},
      }),
    },
  });
}

test.describe('card tools', () => {
  test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
    github.onGraphQL('ProwlSearch', (variables) =>
      searchResponse(nodesFor(variables.query), variables),
    );
    mockDetail(github);
    const on = ['authored', 'review_requested', 'mentioned', 'your_turn'];
    await seedStorage({
      settings: {
        groupByRepo: false,
        localAi: true,
        sections: defaultSettings().sections.map((s) => ({ ...s, enabled: on.includes(s.id) })),
      },
    });
    await signIn();
    await poll();
    for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
  });

  test('the Your turn section lists what waits on you, with why', async ({
    openPanel,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel();
    await panel.getByRole('tab', { name: /^Your turn/ }).click();
    await expect(panel.locator('.turn-summary')).toContainText('Waiting on you');
    await expect(panel.getByText('Fix CI', { exact: true }).first()).toBeVisible();
    await expectNoA11yViolations(panel);
    await saveScreenshot(panel, 'your-turn');
  });

  test("summarizes a pull request and explains its failing checks with Chrome's on-device AI", async ({
    context,
    github,
    openPanel,
    expectNoA11yViolations,
  }) => {
    await context.addInitScript(fakeChromeAi);
    github.onGraphQL('ProwlPullRequestText', () => ({
      node: textNode({}, [failingRunText('build')]),
    }));
    const panel = await openPanel();
    const checkout = await expand(panel, /^Refactor checkout flow/);
    await checkout.getByRole('button', { name: 'Summarize' }).click();
    await checkout.getByRole('button', { name: 'Explain the failure' }).click();
    const why = checkout.getByRole('region', { name: 'Why the checks fail' });
    await expect(why).toContainText('src/checkout/session.ts:42');
    await expect(checkout.getByRole('region', { name: 'Summary' })).toContainText('legacy cart');
    expect(github.requestsFor('ProwlPullRequestText').length).toBeGreaterThan(0);
    await expectNoA11yViolations(panel);
    await checkout.getByRole('region', { name: 'Summary' }).scrollIntoViewIfNeeded();
    await saveScreenshot(panel, 'local-ai');
  });

  test('reads, answers and resolves review conversations from the card', async ({
    github,
    openPanel,
    expectNoA11yViolations,
  }) => {
    const url = (n: number) => `${MOCK_ORIGIN}/acme/web/pull/2481#discussion_r${n}`;
    const said = (login: string, bodyText: string, n: number) => ({
      author: { login },
      bodyText,
      createdAt: '2026-10-05T10:00:00Z',
      url: url(n),
    });
    github.onGraphQL('ProwlReviewThreads', () =>
      threadsResponse([
        threadNode('1', {
          path: 'src/checkout/session.ts',
          line: 42,
          comments: {
            totalCount: 2,
            nodes: [
              said('alice', 'Create the session once per cart, not on every render.', 1),
              said('octocat', 'Good catch, moving it into the cart effect.', 2),
            ],
          },
        }),
        threadNode('3', {
          path: 'src/checkout/reducers.ts',
          line: 8,
          comments: { totalCount: 1, nodes: [said('bob', 'Can this reducer go too?', 3)] },
        }),
      ]),
    );
    const panel = await openPanel();
    const checkout = await expand(panel, /^Refactor checkout flow/);
    await checkout.getByRole('button', { name: /^Show 4 conversations/ }).click();
    const list = checkout.getByRole('list', { name: 'Conversations' });
    await expect(list).toContainText('src/checkout/session.ts:42');
    await expect(list.getByRole('button', { name: 'Resolve' })).toHaveCount(2);
    await expectNoA11yViolations(panel);
    await list.scrollIntoViewIfNeeded();
    await saveScreenshot(panel, 'review-threads');
  });

  test('shows the merge queue position on a branch that merges through a queue', async ({
    github,
    openPanel,
    expectNoA11yViolations,
  }) => {
    github.onGraphQL('ProwlPullRequestDetail', ({ id }) =>
      detailResponse(
        String(id) === RATE_LIMIT
          ? {
              ...(detailsById[RATE_LIMIT] ?? detailNode()),
              isMergeQueueEnabled: true,
              mergeQueueEntry: { position: 2, state: 'QUEUED', estimatedTimeToMerge: 540 },
            }
          : (detailsById[String(id)] ?? detailNode({ baseRef: null })),
      ),
    );
    const panel = await openPanel();
    const queued = await expand(panel, /^Add rate limiting middleware/);
    await expect(queued.getByRole('status').filter({ hasText: 'merge queue' })).toHaveText(
      'In the merge queue: position 2, about 9 min',
    );
    await expect(queued.getByRole('button', { name: 'Remove from merge queue' })).toBeVisible();
    await expect(queued.getByRole('button', { name: /^Merge acme/ })).toHaveCount(0);
    await expectNoA11yViolations(panel);
    await saveScreenshot(panel, 'merge-queue');
  });
});
