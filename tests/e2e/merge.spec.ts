import type { Locator, Page } from '@playwright/test';
import type { PullRequestNode } from '../../src/lib/github/queries';
import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { closedNode, nodesResponse, prId, searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { mockDetail } from './helpers/detailData';
import { authored } from './helpers/listData';

const SEARCH = 'ProwlSearch';
const MERGE = 'ProwlMerge';
const HEAD = 'a'.repeat(40);

/** Approved and clean, in a repository that allows every merge method. */
const API = { id: prId(912, 'acme/api'), ref: 'acme/api#912', title: /^Add rate limiting/ };
/** In a repository that only allows squashing, and says so as its default. */
const DOCS = { id: prId(58, 'octo/docs'), ref: 'octo/docs#58', title: /^Update README badges/ };
/** Octocat wrote it but only has read access to the repository. */
const READ_ONLY = { id: prId(2470, 'acme/web'), title: /^Dark mode: fix contrast/ };
const DRAFT = { title: /^WIP: migrate to Postgres 16/ };

/** What differs from the defaults (merge and squash allowed, default merge, write access). */
const REPOSITORIES: Record<string, Partial<PullRequestNode['repository']>> = {
  [API.id]: { rebaseMergeAllowed: true },
  [DOCS.id]: {
    mergeCommitAllowed: false,
    squashMergeAllowed: true,
    viewerDefaultMergeMethod: 'SQUASH',
  },
  [READ_ONLY.id]: { viewerPermission: 'READ' },
};

const merged = { mergePullRequest: { pullRequest: { merged: true } } };
const failure = (message: string) => ({
  body: { data: null, errors: [{ type: 'UNPROCESSABLE', message }] },
});

const sections = (): Section[] =>
  defaultSettings().sections.map((section) => ({
    ...section,
    enabled: section.kind === 'authored',
  }));

const card = (panel: Page, title: RegExp) =>
  panel.locator('.pr-card', { has: panel.getByRole('link', { name: title }) });
const toasts = (panel: Page) => panel.getByRole('region', { name: 'Messages' });

/** Opens a card, waits for its details to load, and returns it. */
async function expand(panel: Page, title: RegExp): Promise<Locator> {
  const target = card(panel, title);
  await target.getByRole('button', { name: /^Details for / }).click();
  await expect(target.locator('.pr-detail')).toBeVisible();
  await expect(target.getByRole('status')).toHaveCount(0);
  return target;
}

test.describe('merge', () => {
  /** Ids of the pull requests GitHub has merged: gone from the search, final in `ProwlNodes`. */
  let gone: Set<string>;

  test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
    gone = new Set();
    github.onGraphQL(SEARCH, (variables) =>
      searchResponse(
        authored
          .filter(({ id }) => !gone.has(id))
          .map((node) => ({
            ...node,
            repository: { ...node.repository, ...REPOSITORIES[node.id] },
          })),
        variables,
      ),
    );
    github.onGraphQL('ProwlNodes', (variables) =>
      nodesResponse(
        variables.ids,
        [...gone].map((id) => closedNode(id)),
      ),
    );
    mockDetail(github);
    await seedStorage({ settings: { sections: sections() } });
    await signIn();
    await poll();
    // `poll()` leaves the page it sent from open, and it would mark cards seen like a panel.
    for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
  });

  test('merges with the chosen method and title, and the pull request leaves the list', async ({
    github,
    openPanel,
    expectNoA11yViolations,
  }) => {
    github.onGraphQL(MERGE, (variables) => {
      gone.add(String(variables.id));
      return merged;
    });
    const panel = await openPanel();
    const mine = await expand(panel, API.title);
    const opener = mine.getByRole('button', { name: `Merge ${API.ref}` });
    await opener.click();

    const dialog = panel.getByRole('dialog', { name: 'Merge pull request' });
    await expect(dialog).toContainText(`Merge ${API.ref} into main.`);
    await expect(dialog).toContainText('Add rate limiting middleware');
    // Every method the repository allows, the repository's own default first selected.
    const method = dialog.getByRole('combobox', { name: 'Merge method' });
    await expect(method.getByRole('option')).toHaveText([
      'Create a merge commit',
      'Squash and merge',
      'Rebase and merge',
    ]);
    await expect(method).toHaveValue('merge');
    await expect(method).toBeFocused();
    await expectNoA11yViolations(panel);

    await method.selectOption('squash');
    await dialog.getByRole('textbox', { name: /Commit title/ }).fill('Add rate limiting (#912)');
    await panel.emulateMedia({ colorScheme: 'light' });
    await saveScreenshot(panel, 'merge-dialog');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
    await panel.screenshot({ path: test.info().outputPath('merge-dialog-dark.png') });

    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(toasts(panel)).toContainText(`Merged ${API.ref}`);
    expect(github.requestsFor(MERGE)).toHaveLength(1);
    const [request] = github.requestsFor(MERGE);
    expect(request?.body).toMatchObject({
      variables: {
        id: API.id,
        method: 'SQUASH',
        oid: HEAD,
        headline: 'Add rate limiting (#912)',
      },
      query: expect.stringContaining('mergePullRequest'),
    });
    expect(request?.headers.authorization).toBe('Bearer ghp_e2e');
    // The forced poll that follows no longer finds it open.
    await expect(card(panel, API.title)).toHaveCount(0);
    await expect(card(panel, DOCS.title)).toHaveCount(1);
  });

  test('offers only the methods the repository allows, starting on its default', async ({
    github,
    openPanel,
  }) => {
    github.onGraphQL(MERGE, () => merged);
    const panel = await openPanel();
    const docs = await expand(panel, DOCS.title);
    await docs.getByRole('button', { name: `Merge ${DOCS.ref}` }).click();
    const dialog = panel.getByRole('dialog', { name: 'Merge pull request' });
    const method = dialog.getByRole('combobox', { name: 'Merge method' });
    await expect(method.getByRole('option')).toHaveText(['Squash and merge']);
    await expect(method).toHaveValue('squash');

    // A rebase has no commit title to ask for.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const api = await expand(panel, API.title);
    await api.getByRole('button', { name: `Merge ${API.ref}` }).click();
    await dialog.getByRole('combobox', { name: 'Merge method' }).selectOption('rebase');
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(toasts(panel)).toContainText(`Merged ${API.ref}`);
    expect(github.requestsFor(MERGE).map((r) => r.body)).toMatchObject([
      { variables: { id: API.id, method: 'REBASE', oid: HEAD } },
    ]);
  });

  test('Cancel and Escape merge nothing, and Escape leaves the card open', async ({
    github,
    openPanel,
  }) => {
    github.onGraphQL(MERGE, () => merged);
    const panel = await openPanel();
    const mine = await expand(panel, API.title);
    const opener = mine.getByRole('button', { name: `Merge ${API.ref}` });
    const dialog = panel.getByRole('dialog', { name: 'Merge pull request' });

    await opener.click();
    await panel.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(mine.getByRole('button', { name: /^Details for / })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await opener.click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(github.requestsFor(MERGE)).toHaveLength(0);
    await expect(card(panel, API.title)).toHaveCount(1);
  });

  test('has no Merge button without write access or on a draft', async ({ openPanel }) => {
    const panel = await openPanel();
    for (const { title } of [READ_ONLY, DRAFT]) {
      const target = await expand(panel, title);
      await expect(target.getByRole('button', { name: /^Comment on / })).toBeVisible();
      await expect(target.getByRole('button', { name: /^Merge / })).toHaveCount(0);
    }
  });

  test('explains a refusal with GitHub’s words, keeps the card and refreshes', async ({
    github,
    openPanel,
  }) => {
    let refuse = true;
    github.onGraphQL(MERGE, (variables) => {
      if (refuse) return failure('Head branch was modified. Review and try the merge again.');
      gone.add(String(variables.id));
      return merged;
    });
    const panel = await openPanel();
    const mine = await expand(panel, API.title);
    const opener = mine.getByRole('button', { name: `Merge ${API.ref}` });
    const polls = github.requestsFor(SEARCH).length;

    await opener.click();
    const dialog = panel.getByRole('dialog', { name: 'Merge pull request' });
    await dialog.getByRole('combobox', { name: 'Merge method' }).selectOption('squash');
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    // The dialog closes so the toast is not hidden behind it.
    await expect(dialog).toHaveCount(0);
    await expect(toasts(panel)).toContainText(
      'Merge failed: Head branch was modified. Review and try the merge again.',
    );
    await expect(card(panel, API.title)).toHaveCount(1);
    await expect(opener).toBeEnabled();
    await expect(opener).not.toHaveAttribute('aria-busy', 'true');
    // The head moved, so the panel asks for a fresh copy of the pull request.
    await expect.poll(() => github.requestsFor(SEARCH).length).toBeGreaterThan(polls);

    // Trying again keeps the method that was chosen, and now works.
    refuse = false;
    await opener.click();
    await expect(dialog.getByRole('combobox', { name: 'Merge method' })).toHaveValue('squash');
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(toasts(panel)).toContainText(`Merged ${API.ref}`);
    await expect(card(panel, API.title)).toHaveCount(0);
    expect(github.requestsFor(MERGE)).toHaveLength(2);
  });
});
