import type { Page } from '@playwright/test';
import type { Settings } from '../../src/lib/model';
import { defaultSettings } from '../../src/lib/storage/settings';
import { prNode, searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { nodesFor } from './helpers/listData';
import { MOCK_ORIGIN } from './mock-github/server';

const BUG = prNode({ number: 7, title: 'Fix flaky login test', repository: 'acme/web' });

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
    // Chrome knows the open-panel command. Whether it binds the suggested key depends on how the
    // extension was installed (an unpacked test load gets none), so About says either way.
    const commands = await serviceWorker.evaluate(() => chrome.commands.getAll());
    expect(commands.map(({ name, description }) => ({ name, description }))).toContainEqual({
      name: 'open-panel',
      description: 'Open Prowl',
    });
    await expect(group(panel, 'About')).toContainText('Change it at chrome://extensions/shortcuts');

    for (const [name, path] of [
      ['Documentation', '/aemard/prowl#readme'],
      ['Privacy', '/aemard/prowl/blob/main/docs/privacy.md'],
      ['Source code', '/aemard/prowl'],
    ] as const) {
      const opened = context.waitForEvent('page');
      await group(panel, 'About').getByRole('link', { name }).click();
      const page = await opened;
      expect(page.url()).toBe(`${MOCK_ORIGIN}${path}`);
      await page.close();
    }
  });
});

test.describe('privacy and permissions', () => {
  test('promises no access to the pages and lists what Chrome granted', async ({
    context,
    openPanel,
    serviceWorker,
    expectNoA11yViolations,
  }) => {
    const panel = await openPanel('#/settings');
    const privacy = group(panel, 'Privacy and permissions');
    await expect(privacy).toContainText(
      'Prowl cannot see or change the pages you visit: it has no access to your tabs or their content.',
    );

    // The rows are what Chrome reports for the loaded extension, not a copy of the docs.
    const granted = await serviceWorker.evaluate(() => chrome.permissions.getAll());
    const rows = privacy.getByRole('list', { name: 'What Prowl may do' }).getByRole('listitem');
    await expect(rows).toHaveCount(
      (granted.permissions?.length ?? 0) + (granted.origins?.length ?? 0),
    );
    await expect(rows.locator('.settings-permissions__name')).toHaveText([
      'Side panel',
      'Storage',
      'Alarms',
      'Notifications',
      new URL(MOCK_ORIGIN).host,
    ]);
    await expect(rows.last()).toContainText('Read your pull requests and act on them');

    for (const colorScheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme });
      await expectNoA11yViolations(panel);
    }

    const opened = context.waitForEvent('page');
    await privacy.getByRole('link', { name: 'Read the privacy policy' }).click();
    const page = await opened;
    expect(page.url()).toBe(`${MOCK_ORIGIN}/aemard/prowl/blob/main/docs/privacy.md`);
    await page.close();
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
    // The e2e build talks to the mock server; the image shows the host the shipped build has.
    await expect(panel.locator('.settings-permissions__name').last()).toHaveText(
      new URL(MOCK_ORIGIN).host,
    );
    await panel.evaluate((mock) => {
      for (const name of document.querySelectorAll('.settings-permissions__name'))
        if (name.textContent === mock) name.textContent = 'api.github.com';
    }, new URL(MOCK_ORIGIN).host);
    await saveScreenshot(panel, 'settings', { fullPage: true });
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.screenshot({ path: test.info().outputPath('settings-dark.png'), fullPage: true });
  });
});
