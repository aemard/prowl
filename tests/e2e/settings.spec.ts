import { resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import type { Settings } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { headCommit, prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

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

/** The `section` of the settings screen under the heading `title`. */
const group = (panel: Page, title: string) =>
  panel.locator('section', { has: panel.getByRole('heading', { level: 3, name: title }) });

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

test.describe('scope', () => {
  test('turning a section on fetches it without waiting for the next poll', async ({
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
    await expect(panel.getByRole('tab', { name: /Review requested/ })).toHaveText(
      'Review requested3',
    );
  });

  test('adds, edits and removes a custom section, checking its query first', async ({
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

    await expect(panel.getByRole('switch', { name: 'Bugs' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect
      .poll(() => searches(github).some((query) => query.includes('label:bug')))
      .toBe(true);
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

  test('include and exclude lists take owners and repositories, and nothing else', async ({
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
    expect((await savedSettings(serviceWorker))?.repoExclude).toEqual(['acme/legacy']);
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
});

test.describe('refresh', () => {
  test('the service worker reschedules polling when the interval changes', async ({
    openPanel,
    serviceWorker,
  }) => {
    expect(await pollPeriod(serviceWorker)).toBe(2);
    const panel = await openPanel('#/settings');
    const interval = panel.getByLabel('Check every (minutes)');
    await expect(interval).toHaveValue('2');
    await expect(panel.getByText(/5,000 points an hour/)).toBeVisible();

    await interval.fill('7');
    await expect.poll(() => pollPeriod(serviceWorker)).toBe(7);
    expect((await savedSettings(serviceWorker))?.pollIntervalMinutes).toBe(7);

    // Less than one minute is refused, and the schedule stays.
    await interval.fill('0');
    await expect(panel.getByText('Enter a whole number from 1 to 60.')).toBeVisible();
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

test.describe('appearance', () => {
  test('theme applies at once, and survives a reload', async ({ openPanel }) => {
    const panel = await openPanel('#/settings');
    await panel.getByLabel('Theme').selectOption('dark');
    await expect(panel.locator('html')).toHaveAttribute('data-theme', 'dark');
    await panel.reload();
    await expect(panel.getByLabel('Theme')).toHaveValue('dark');
    await expect(panel.locator('html')).toHaveAttribute('data-theme', 'dark');
    await panel.getByLabel('Theme').selectOption('system');
    await expect(panel.locator('html')).not.toHaveAttribute('data-theme');
  });

  test('sort order applies to the list', async ({ openPanel }) => {
    const panel = await openPanel('#/settings');
    await panel.getByLabel('Sort pull requests by').selectOption('repo');
    await panel.getByRole('button', { name: 'Back to pull requests' }).click();
    const repos = await panel.locator('.pr-card').first().textContent();
    expect(repos).toContain('acme/api');
  });

  test('the toolbar badge follows the mode', async ({ openPanel, serviceWorker }) => {
    const badge = () => serviceWorker.evaluate(() => chrome.action.getBadgeText({}));
    await expect.poll(badge).not.toBe('');
    const panel = await openPanel('#/settings');
    await panel.getByLabel('Toolbar badge').selectOption('off');
    await expect.poll(badge).toBe('');
    await expect(panel.getByText('The toolbar icon shows no number.')).toBeVisible();
    await panel.getByLabel('Toolbar badge').selectOption('attention');
    await expect.poll(badge).not.toBe('');
  });
});

test.describe('account and about', () => {
  test('shows the account and signs out after a confirmation', async ({
    openPanel,
    serviceWorker,
    signIn,
  }) => {
    await signIn({ scopes: ['repo', 'read:org'] });
    const panel = await openPanel('#/settings');
    const account = group(panel, 'Account');
    await expect(account).toContainText('octocat');
    await expect(account).toContainText('Classic personal access token');
    await expect(account.getByText('read:org')).toBeVisible();
    // No secret on screen: only the kind of token.
    await expect(panel.locator('body')).not.toContainText('ghp_e2e');

    await account.getByRole('button', { name: 'Sign out' }).click();
    await panel
      .getByRole('dialog', { name: 'Sign out?' })
      .getByRole('button', { name: 'Cancel' })
      .click();
    await expect(account).toBeVisible();

    await account.getByRole('button', { name: 'Sign out' }).click();
    await panel.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
    await expect(panel.getByRole('heading', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect
      .poll(() =>
        serviceWorker.evaluate(async () => Object.keys(await chrome.storage.local.get(null))),
      )
      .not.toContain('auth');
  });

  test('shows the version and opens the project pages on GitHub', async ({
    context,
    openPanel,
    serviceWorker,
  }) => {
    const panel = await openPanel('#/settings');
    const version = await serviceWorker.evaluate(() => chrome.runtime.getManifest().version);
    await expect(group(panel, 'About')).toContainText(`Version ${version}`);

    for (const [name, path] of [
      ['Documentation', '/aemard/prowl/tree/main/docs'],
      ['Privacy', '/aemard/prowl/blob/main/docs/privacy.md'],
      ['Source code', '/aemard/prowl'],
    ] as const) {
      const opened = context.waitForEvent('page');
      await panel.getByRole('link', { name }).click();
      const page = await opened;
      expect(page.url()).toBe(`${MOCK_ORIGIN}${path}`);
      await page.close();
    }
  });
});

test.describe('look', () => {
  /** A fully used screen: custom section, filters, quiet hours, a token with scopes. */
  const busy: Partial<Settings> = {
    ...defaultSettings(),
    sections: [
      ...defaultSettings().sections.map((section) => ({
        ...section,
        enabled: section.id !== 'assigned',
      })),
      { id: 'custom-1', kind: 'custom', label: 'Bugs', enabled: true, query: 'label:bug' },
    ],
    repoInclude: ['acme', 'octo/docs'],
    repoExclude: ['northwind-engineering/internal-platform-services-monorepo'],
    notifications: {
      ...defaultSettings().notifications,
      events: { ...defaultSettings().notifications.events, ci_passed: false },
      quietHours: { enabled: true, start: '22:00', end: '08:00' },
    },
  };

  test('is accessible in light and dark, and fits the panel', async ({
    openPanel,
    seedStorage,
    signIn,
    expectNoA11yViolations,
  }) => {
    await seedStorage({ settings: busy });
    await signIn({ scopes: ['repo', 'read:org'] });
    const panel = await openPanel('#/settings');
    await expect(panel.getByRole('switch', { name: 'Bugs' })).toBeVisible();

    for (const colorScheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme });
      await expectNoA11yViolations(panel);
    }

    // The dialog, too, and the field errors it shows.
    await panel.getByRole('button', { name: 'Add custom section' }).click();
    await panel.getByRole('button', { name: 'Save' }).click();
    await expectNoA11yViolations(panel);
    await panel.screenshot({ path: test.info().outputPath('dialog.png') });
    await panel.keyboard.press('Escape');

    const overflow = await panel.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('screenshot', async ({ openPanel, seedStorage, signIn }) => {
    await seedStorage({ settings: busy });
    await signIn({ scopes: ['repo', 'read:org'] });
    const panel = await openPanel('#/settings');
    await panel.emulateMedia({ colorScheme: 'light' });
    await expect(panel.getByRole('switch', { name: 'Bugs' })).toBeVisible();
    await panel.screenshot({
      path: resolve(import.meta.dirname, '../../docs/screenshots/settings.png'),
      fullPage: true,
    });
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.screenshot({ path: test.info().outputPath('settings-dark.png'), fullPage: true });
  });
});
