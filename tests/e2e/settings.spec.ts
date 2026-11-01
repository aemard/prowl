import type { Worker } from '@playwright/test';
import type { Settings } from '../../src/lib/model';
import { headCommit, prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { nodesFor } from './helpers/listData';

const BUG = prNode({ number: 7, title: 'Fix flaky login test', repository: 'acme/web' });

/** The scripts the panel sent to GitHub as search queries, oldest first. */
const searches = (github: Parameters<Parameters<typeof test>[2]>[0]['github']) =>
  github
    .requestsFor('ProwlSearch')
    .map((request) => String((request.body as { variables: { query: string } }).variables.query));

const savedSettings = (worker: Worker) =>
  worker.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings as Settings | undefined,
  );
const pollPeriod = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.alarms.get('poll'))?.periodInMinutes);
const notificationIds = (worker: Worker) =>
  worker.evaluate(async () => Object.keys(await chrome.notifications.getAll()));

test.beforeEach(async ({ context, github, signIn, poll }) => {
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      String(variables.query).includes('label:bug') ? [BUG] : nodesFor(variables.query),
      variables,
    ),
  );
  await signIn();
  await poll();
  // `poll()` leaves the page it sent from open, and it would mark cards seen like a panel.
  for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();
});
test('scope › turning a section on fetches it without waiting for the next poll', async ({
  openPanel,
  github,
}) => {
  const panel = await openPanel('#/settings');
  const section = panel.getByRole('switch', { name: 'Review requested' });
  await expect(section).toHaveAttribute('aria-checked', 'false');
  await section.click();
  await expect(section).toHaveAttribute('aria-checked', 'true');

  await expect
    .poll(() => searches(github).some((query) => query.includes('review-requested:@me')))
    .toBe(true);
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();
  await expect(panel.getByRole('tab', { name: /^Review/ })).toHaveText('Review3');
});

test('scope › adds, edits and removes a custom section, checking its query first', async ({
  openPanel,
  github,
}) => {
  const panel = await openPanel('#/settings');
  await panel.getByRole('button', { name: 'Add custom section' }).click();
  const dialog = panel.getByRole('dialog', { name: 'Add custom section' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Give the section a name.')).toBeVisible();
  await expect(dialog.getByLabel('Name')).toBeFocused();

  await dialog.getByLabel('Name').fill('Bugs');
  await dialog.getByLabel('Search query').fill('is:issue label:bug');
  await expect(dialog.getByText(/follows pull requests only/)).toBeVisible();
  await dialog.getByLabel('Search query').fill('label:bug');
  await expect(dialog.getByText(/follows pull requests only/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(panel.getByRole('switch', { name: 'Bugs' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => searches(github).some((query) => query.includes('label:bug'))).toBe(true);
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();
  await expect(panel.getByRole('tab', { name: /Bugs/ })).toHaveText('Bugs1');
  await panel.getByRole('tab', { name: /Bugs/ }).click();
  await expect(panel.locator('.pr-card')).toContainText('Fix flaky login test');

  await panel.getByRole('button', { name: 'Settings' }).click();
  await panel.getByRole('button', { name: 'Edit Bugs' }).click();
  await panel.getByLabel('Name').fill('Flaky tests');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('switch', { name: 'Flaky tests' })).toBeVisible();

  await panel.getByRole('button', { name: 'Remove Flaky tests' }).click();
  await expect(panel.getByRole('switch', { name: 'Flaky tests' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Undo' }).click();
  await expect(panel.getByRole('switch', { name: 'Flaky tests' })).toBeVisible();
});

test('scope › include and exclude lists take owners and repositories, and nothing else', async ({
  openPanel,
  serviceWorker,
  github,
}) => {
  const panel = await openPanel('#/settings');
  const include = panel.getByRole('group', { name: 'Include' });
  const field = include.getByLabel('Include repository');
  await field.fill('acme/web/extra');
  await include.getByRole('button', { name: 'Add to include list' }).click();
  await expect(include.getByText(/Enter an owner or owner\/name/)).toBeVisible();

  await field.fill('acme');
  await field.press('Enter');
  await field.fill('octo/docs');
  await field.press('Enter');
  await expect(include.getByRole('listitem')).toHaveText(['acme', 'octo/docs']);
  await panel
    .getByRole('group', { name: 'Exclude' })
    .getByLabel('Exclude repository')
    .fill('acme/legacy');
  await panel.getByRole('button', { name: 'Add to exclude list' }).click();

  await expect
    .poll(async () => (await savedSettings(serviceWorker))?.repoInclude)
    .toEqual(['acme', 'octo/docs']);
  await expect
    .poll(async () => (await savedSettings(serviceWorker))?.repoExclude)
    .toEqual(['acme/legacy']);
  await expect
    .poll(() =>
      searches(github).some(
        (query) =>
          query.includes('user:acme') &&
          query.includes('repo:octo/docs') &&
          query.includes('-repo:acme/legacy'),
      ),
    )
    .toBe(true);

  await include.getByRole('button', { name: 'Remove acme', exact: true }).click();
  await expect(include.getByRole('listitem')).toHaveText(['octo/docs']);
  await expect(field).toBeFocused();
});

test.describe('refresh', () => {
  test('the service worker reschedules polling when the interval changes', async ({
    openPanel,
    serviceWorker,
  }) => {
    expect(await pollPeriod(serviceWorker)).toBe(5);
    const panel = await openPanel('#/settings');
    const interval = panel.getByLabel('Check every (minutes)');
    await expect(interval).toHaveValue('5');
    await expect(panel.getByText(/5,000 points an hour/)).toBeVisible();

    await interval.fill('7');
    await expect.poll(() => pollPeriod(serviceWorker)).toBe(7);
    expect((await savedSettings(serviceWorker))?.pollIntervalMinutes).toBe(7);

    // Less than two minutes is refused, and the schedule stays.
    await interval.fill('1');
    await expect(panel.getByText('Enter a whole number from 2 to 60.')).toBeVisible();
    await interval.blur();
    await expect(interval).toHaveValue('7');
    expect(await pollPeriod(serviceWorker)).toBe(7);
  });

  test('saves how many pull requests each section fetches', async ({
    openPanel,
    serviceWorker,
    github,
  }) => {
    const panel = await openPanel('#/settings');
    await panel.getByLabel('Pull requests per section').fill('20');
    await expect.poll(async () => (await savedSettings(serviceWorker))?.maxPerSection).toBe(20);
    await expect
      .poll(() =>
        github
          .requestsFor('ProwlSearch')
          .some(
            (request) => (request.body as { variables: { first: number } }).variables.first === 20,
          ),
      )
      .toBe(true);
  });
});

test.describe('notifications', () => {
  test('a test notification appears with the Prowl icon', async ({ openPanel, serviceWorker }) => {
    const panel = await openPanel('#/settings');
    await panel.getByRole('switch', { name: 'Desktop notifications' }).click();
    await panel.getByRole('button', { name: 'Send test notification' }).click();
    await expect(panel.getByText('Test notification sent.')).toBeVisible();
    await expect.poll(async () => (await notificationIds(serviceWorker)).length).toBe(1);
    expect((await notificationIds(serviceWorker))[0]).toMatch(/^test:\d+$/);
  });

  test('the switches decide which events notify', async ({ openPanel, serviceWorker, github }) => {
    let checks: Record<string, number> = { SUCCESS: 1, IN_PROGRESS: 1 };
    github.onGraphQL('ProwlSearch', (variables) =>
      searchResponse([prNode({ number: 1, commits: headCommit(checks) })], variables),
    );
    const panel = await openPanel('#/settings');
    await panel.getByRole('switch', { name: 'Desktop notifications' }).click();
    const poll = () =>
      panel.evaluate(() => chrome.runtime.sendMessage({ type: 'poll', force: true }));
    await poll();

    const ciFails = panel.getByRole('switch', { name: 'CI fails' });
    await ciFails.click();
    await expect(ciFails).toHaveAttribute('aria-checked', 'false');
    await expect
      .poll(async () => (await savedSettings(serviceWorker))?.notifications.events.ci_failed)
      .toBe(false);
    checks = { SUCCESS: 1, FAILURE: 1 };
    await poll();
    expect(await notificationIds(serviceWorker)).toEqual([]);

    // The master switch greys the rest out; turning it back on brings them back.
    const master = panel.getByRole('switch', { name: 'Desktop notifications' });
    await master.click();
    await expect(panel.getByRole('switch', { name: 'CI passes' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Send test notification' })).toBeDisabled();
    await master.click();
    await expect(panel.getByRole('switch', { name: 'CI passes' })).toBeEnabled();
  });

  test('quiet hours can cross midnight', async ({ openPanel, serviceWorker }) => {
    const panel = await openPanel('#/settings');
    await panel.getByRole('switch', { name: 'Desktop notifications' }).click();
    const from = panel.getByLabel('From');
    await expect(from).toBeDisabled();
    await panel.getByRole('switch', { name: 'Quiet hours' }).click();
    await expect(from).toBeEnabled();
    await expect(panel.getByText(/crosses midnight/)).toBeVisible();

    await from.fill('23:30');
    await panel.getByLabel('Until').fill('06:15');
    await expect(panel.getByText(/crosses midnight/)).toBeVisible();
    await expect
      .poll(async () => (await savedSettings(serviceWorker))?.notifications.quietHours)
      .toEqual({ enabled: true, start: '23:30', end: '06:15' });
  });
});
