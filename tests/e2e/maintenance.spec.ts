import type { Locator, Page } from '@playwright/test';
import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { nodesResponse, prId, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { mockDetail } from './helpers/detailData';
import { authored } from './helpers/listData';

const FAILING = {
  id: prId(2481, 'acme/web'),
  ref: 'acme/web#2481',
  title: /^Refactor checkout flow/,
};
const DRAFT = {
  id: prId(905, 'acme/api'),
  ref: 'acme/api#905',
  title: /^WIP: migrate to Postgres 16/,
};
const READY = { id: prId(912, 'acme/api'), ref: 'acme/api#912', title: /^Add rate limiting/ };

const sections = (): Section[] =>
  defaultSettings().sections.map((s) => ({ ...s, enabled: s.kind === 'authored' }));
const card = (panel: Page, title: RegExp) =>
  panel.locator('.pr-card', { has: panel.getByRole('link', { name: title }) });
const toasts = (panel: Page) => panel.getByRole('region', { name: 'Messages' });

async function expand(panel: Page, title: RegExp): Promise<Locator> {
  const target = card(panel, title);
  await target.getByRole('button', { name: /^Details for / }).click();
  await expect(target.locator('.pr-detail')).toBeVisible();
  return target;
}

test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse(authored, variables));
  github.onGraphQL('ProwlNodes', (variables) => nodesResponse(variables.ids, []));
  mockDetail(github);
  await seedStorage({ settings: { sections: sections() } });
  await signIn();
  await poll();
  for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
});

test('re-runs failed Actions jobs and other failed check suites', async ({
  github,
  openPanel,
  expectNoA11yViolations,
}) => {
  github.onGraphQL('ProwlFailedSuites', () => ({
    node: {
      repository: { owner: { login: 'acme' }, name: 'web' },
      commits: {
        nodes: [
          {
            commit: {
              checkSuites: {
                nodes: [
                  { databaseId: 11, conclusion: 'FAILURE', workflowRun: { databaseId: 501 } },
                  { databaseId: 12, conclusion: 'FAILURE', workflowRun: null },
                  { databaseId: 13, conclusion: 'SUCCESS', workflowRun: { databaseId: 502 } },
                ],
              },
            },
          },
        ],
      },
    },
  }));
  github.on(
    'POST',
    /^\/repos\/acme\/web\/(actions\/runs\/501\/rerun-failed-jobs|check-suites\/12\/rerequest)$/,
    () => ({
      status: 201,
    }),
  );
  const panel = await openPanel();
  const target = await expand(panel, FAILING.title);
  await expectNoA11yViolations(panel);
  await target.getByRole('button', { name: `Re-run failed checks of ${FAILING.ref}` }).click();
  await expect(toasts(panel)).toContainText(`Re-running failed checks of ${FAILING.ref}`);

  const posted = github.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/repos/'));
  expect(posted.map((r) => r.path).sort()).toEqual([
    '/repos/acme/web/actions/runs/501/rerun-failed-jobs',
    '/repos/acme/web/check-suites/12/rerequest',
  ]);
  expect(github.requestsFor('ProwlFailedSuites')[0]?.body).toMatchObject({
    variables: { id: FAILING.id },
  });
  // Passing pull requests offer no re-run.
  const ready = await expand(panel, READY.title);
  await expect(ready.getByRole('button', { name: /^Re-run failed checks/ })).toHaveCount(0);
});

test('marks a draft ready for review and converts a ready PR to draft', async ({
  github,
  openPanel,
}) => {
  github.onGraphQL('ProwlMarkReady', () => ({
    markPullRequestReadyForReview: { pullRequest: { isDraft: false } },
  }));
  github.onGraphQL('ProwlConvertToDraft', () => ({
    convertPullRequestToDraft: { pullRequest: { isDraft: true } },
  }));
  const panel = await openPanel();
  const draft = await expand(panel, DRAFT.title);
  await draft.getByRole('button', { name: `Ready for review: ${DRAFT.ref}` }).click();
  await expect(toasts(panel)).toContainText(`Marked ready for review: ${DRAFT.ref}`);
  expect(github.requestsFor('ProwlMarkReady')[0]?.body).toMatchObject({
    variables: { id: DRAFT.id },
  });

  const ready = await expand(panel, READY.title);
  await ready.getByRole('button', { name: `Convert to draft: ${READY.ref}` }).click();
  await expect(toasts(panel)).toContainText(`Converted to draft: ${READY.ref}`);
  expect(github.requestsFor('ProwlConvertToDraft')).toHaveLength(1);
});
