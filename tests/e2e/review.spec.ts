import type { Locator, Page } from '@playwright/test';
import type { Section } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { prId, searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { mockDetail } from './helpers/detailData';
import { nodesFor } from './helpers/listData';

const SEARCH = 'ProwlSearch';
/** Somebody else's pull request, in "Review requested", and one of octocat's own. */
const THEIRS = {
  id: prId(2490, 'acme/web'),
  ref: 'acme/web#2490',
  title: /^Add keyboard shortcuts/,
};
const MINE = { id: prId(912, 'acme/api'), ref: 'acme/api#912', title: /^Add rate limiting/ };

const reviewed = { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } };
const commented = { addComment: { commentEdge: { node: { id: 'IC_1' } } } };
const failure = (message: string) => ({
  body: { data: null, errors: [{ type: 'FORBIDDEN', message }] },
});

const sections = (): Section[] =>
  defaultSettings().sections.map((section) => ({
    ...section,
    enabled: section.kind === 'authored' || section.kind === 'review_requested',
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

test.describe('review actions', () => {
  test.beforeEach(async ({ context, github, seedStorage, signIn, poll }) => {
    github.onGraphQL(SEARCH, (variables) => searchResponse(nodesFor(variables.query), variables));
    mockDetail(github);
    await seedStorage({ settings: { sections: sections() } });
    await signIn();
    await poll();
    // `poll()` leaves the page it sent from open, and it would mark cards seen like a panel.
    for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
  });

  test('approves in one click, with the exact mutation, a toast and a refresh', async ({
    github,
    openPanel,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    github.onGraphQL('ProwlApprove', async () => {
      await gate;
      return reviewed;
    });
    const panel = await openPanel();
    await panel.getByRole('tab', { name: /^Review/ }).click();
    const theirs = await expand(panel, THEIRS.title);
    const polls = github.requestsFor(SEARCH).length;

    const approve = theirs.getByRole('button', { name: `Approve ${THEIRS.ref}` });
    await approve.click();
    // One click, no dialog; while it runs the PR's buttons are disabled and a second click is moot.
    await expect(panel.getByRole('dialog')).toHaveCount(0);
    await expect(approve).toHaveAttribute('aria-busy', 'true');
    await expect(approve).toBeDisabled();
    await expect(theirs.getByRole('button', { name: /^Request changes / })).toBeDisabled();
    await expect(theirs.getByRole('button', { name: /^Comment on / })).toBeDisabled();
    await approve.click({ force: true });
    release();

    await expect(toasts(panel)).toContainText(`Approved ${THEIRS.ref}`);
    expect(github.requestsFor('ProwlApprove')).toHaveLength(1);
    const [request] = github.requestsFor('ProwlApprove');
    expect(request?.body).toMatchObject({
      variables: { id: THEIRS.id, event: 'APPROVE', oid: expect.stringMatching(/^[0-9a-f]{40}$/) },
      query: expect.stringContaining('addPullRequestReview'),
    });
    expect(request?.headers.authorization).toBe('Bearer ghp_e2e');
    await expect(approve).toBeEnabled();
    await expect(approve).not.toHaveAttribute('aria-busy', 'true');
    // The forced poll that follows brings the new state in.
    await expect.poll(() => github.requestsFor(SEARCH).length).toBeGreaterThan(polls);
  });

  test('requests changes only with a message, in a dialog that is accessible', async ({
    github,
    openPanel,
    expectNoA11yViolations,
  }) => {
    github.onGraphQL('ProwlRequestChanges', () => reviewed);
    const panel = await openPanel();
    await panel.getByRole('tab', { name: /^Review/ }).click();
    const theirs = await expand(panel, THEIRS.title);
    const opener = theirs.getByRole('button', { name: `Request changes ${THEIRS.ref}` });
    await opener.click();

    const dialog = panel.getByRole('dialog', { name: 'Request changes' });
    await expect(dialog).toContainText(`Tell the author what has to change in ${THEIRS.ref}.`);
    const message = dialog.getByRole('textbox', { name: 'Message' });
    await expect(message).toBeFocused();
    await expectNoA11yViolations(panel);

    // No message: told so right there, nothing sent.
    await dialog.getByRole('button', { name: 'Request changes' }).click();
    await expect(dialog.getByText('Write a message first.')).toBeVisible();
    expect(github.requestsFor('ProwlRequestChanges')).toHaveLength(0);
    await message.fill('The retry loop never gives up.\nPlease add a limit and a test.');
    await expect(dialog.getByText('Write a message first.')).toHaveCount(0);

    await panel.emulateMedia({ colorScheme: 'light' });
    await saveScreenshot(panel, 'review-dialog');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations(panel);
    await panel.screenshot({ path: test.info().outputPath('review-dialog-dark.png') });

    await dialog.getByRole('button', { name: 'Request changes' }).click();
    await expect(toasts(panel)).toContainText(`Requested changes on ${THEIRS.ref}`);
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(github.requestsFor('ProwlRequestChanges').map((r) => r.body)).toMatchObject([
      {
        variables: {
          id: THEIRS.id,
          event: 'REQUEST_CHANGES',
          body: 'The retry loop never gives up.\nPlease add a limit and a test.',
        },
      },
    ]);
  });

  test('Escape closes the dialog but not the card, and Cancel sends nothing', async ({
    github,
    openPanel,
  }) => {
    const panel = await openPanel();
    await panel.getByRole('tab', { name: /^Review/ }).click();
    const theirs = await expand(panel, THEIRS.title);
    const opener = theirs.getByRole('button', { name: `Request changes ${THEIRS.ref}` });
    await opener.click();
    const dialog = panel.getByRole('dialog', { name: 'Request changes' });
    await dialog.getByRole('textbox', { name: 'Message' }).fill('Not yet');
    await panel.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(theirs.getByRole('button', { name: /^Details for / })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await opener.click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(github.requestsFor('ProwlRequestChanges')).toHaveLength(0);

    // A second Escape, with nothing open, folds the card as before.
    await panel.keyboard.press('Escape');
    await expect(theirs.getByRole('button', { name: /^Details for / })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('explains a refusal in a toast with GitHub’s words, never the token', async ({
    github,
    openPanel,
  }) => {
    github.onGraphQL('ProwlApprove', () =>
      failure('Resource not accessible by personal access token ghp_e2e'),
    );
    github.onGraphQL('ProwlRequestChanges', () => failure('Review could not be submitted'));
    const panel = await openPanel();
    await panel.getByRole('tab', { name: /^Review/ }).click();
    const theirs = await expand(panel, THEIRS.title);
    const polls = github.requestsFor(SEARCH).length;

    const approve = theirs.getByRole('button', { name: `Approve ${THEIRS.ref}` });
    await approve.click();
    await expect(toasts(panel)).toContainText(
      'Approve failed: Resource not accessible by personal access token [redacted]',
    );
    await expect(approve).toBeEnabled();
    await expect(panel.locator('body')).not.toContainText('ghp_e2e');

    // The dialog closes, the reason is in a toast and what was written is still there.
    await theirs.getByRole('button', { name: `Request changes ${THEIRS.ref}` }).click();
    const dialog = panel.getByRole('dialog', { name: 'Request changes' });
    await dialog.getByRole('textbox', { name: 'Message' }).fill('Please add a test');
    await dialog.getByRole('button', { name: 'Request changes' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toasts(panel)).toContainText(
      'Request changes failed: Review could not be submitted',
    );
    await theirs.getByRole('button', { name: `Request changes ${THEIRS.ref}` }).click();
    await expect(dialog.getByRole('textbox', { name: 'Message' })).toHaveValue('Please add a test');

    // A failure changes nothing on GitHub, so nothing to refresh.
    expect(github.requestsFor(SEARCH)).toHaveLength(polls);
  });

  test('comments on your own pull request, which cannot be approved', async ({
    github,
    openPanel,
  }) => {
    github.onGraphQL('ProwlComment', () => commented);
    const panel = await openPanel();
    const mine = await expand(panel, MINE.title);
    await expect(mine.getByRole('button', { name: /^Approve / })).toHaveCount(0);
    await expect(mine.getByRole('button', { name: /^Request changes / })).toHaveCount(0);

    await mine.getByRole('button', { name: `Comment on ${MINE.ref}` }).click();
    const dialog = panel.getByRole('dialog', { name: 'Comment' });
    await expect(dialog).toContainText(`Add a comment to the conversation of ${MINE.ref}.`);
    await dialog.getByRole('textbox', { name: 'Message' }).fill('Rebased, ready for another look.');
    await dialog.getByRole('button', { name: 'Comment' }).click();
    await expect(toasts(panel)).toContainText(`Commented on ${MINE.ref}`);
    expect(github.requestsFor('ProwlComment').map((r) => r.body)).toMatchObject([
      {
        variables: { id: MINE.id, body: 'Rebased, ready for another look.' },
        query: expect.stringContaining('addComment'),
      },
    ]);
  });
});
