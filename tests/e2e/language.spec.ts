import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultSettings } from '../../src/lib/storage/settings';
import { headCommit, prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';

function messages(language: string): Record<string, { message: string }> {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        `../../public/_locales/${language.replace('-', '_')}/messages.json`,
      ),
      'utf8',
    ),
  );
}

test.use({ locale: 'en-US' });

test('an opening panel keeps a newer choice made while its first catalog is loading', async ({
  context,
  seedStorage,
  signIn,
  openPanel,
}) => {
  await seedStorage({ settings: { ...defaultSettings(), language: 'fr' } });
  await signIn();
  await context.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof originalFetch>) => {
      if (String(args[0]).includes('/_locales/fr/messages.json')) {
        await new Promise<void>((resolve) => {
          Object.assign(globalThis, { releaseLanguageCatalog: resolve });
        });
      }
      return originalFetch(...args);
    };
  });
  const panel = await openPanel('#/settings');
  await expect
    .poll(() =>
      panel.evaluate(
        () => typeof (globalThis as { releaseLanguageCatalog?: () => void }).releaseLanguageCatalog,
      ),
    )
    .toBe('function');
  await seedStorage({ settings: { ...defaultSettings(), language: 'ja' } });
  await panel.evaluate(() => {
    (globalThis as { releaseLanguageCatalog?: () => void }).releaseLanguageCatalog?.();
  });
  await expect(panel.getByRole('heading', { level: 2, name: '設定', exact: true })).toBeVisible();
  await expect(panel.locator('select[name="language"]')).toHaveValue('ja');
});

test('language picker overrides Chrome in every language, follows open panels and survives reopening', async ({
  openPanel,
  signIn,
  serviceWorker,
  expectNoA11yViolations,
}) => {
  await signIn();
  const panel = await openPanel('#/settings');
  const other = await openPanel('#/settings');
  const field = panel.locator('select[name="language"]');
  await expect(field).toHaveValue('system');
  for (const language of ['fr', 'ja', 'zh-CN', 'zh-TW', 'de', 'es', 'en', 'system']) {
    const catalog = messages(language === 'system' ? 'en' : language);
    await field.selectOption(language);
    for (const page of [panel, other]) {
      await expect(
        page.getByRole('heading', { level: 2, name: catalog.settings?.message, exact: true }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute(
        'lang',
        catalog.languageTag?.message ?? '',
      );
      await expect(page.getByRole('main')).toHaveAttribute(
        'aria-label',
        catalog.settings?.message ?? '',
      );
      await expect(
        page.getByRole('combobox', { name: catalog.language?.message, exact: true }),
      ).toHaveValue(language);
      await expect(
        page.getByRole('combobox', { name: catalog.theme?.message, exact: true }),
      ).toContainText(catalog.matchSystem?.message ?? '');
      await expect(page.locator('.settings__nav a').first()).toHaveText(
        catalog.sections?.message ?? '',
      );
      expect(new URL(page.url()).hash).toBe('#/settings');
    }
    expect(
      await serviceWorker.evaluate(
        async () =>
          (await chrome.storage.local.get<{ settings: { language: string } }>('settings')).settings
            .language,
      ),
    ).toBe(language);
  }
  await field.selectOption('ja');
  await expect(panel.getByRole('heading', { level: 2, name: '設定', exact: true })).toBeVisible();
  await panel.close();
  const reopened = await openPanel('#/settings');
  await expect(reopened.locator('select[name="language"]')).toHaveValue('ja');
  await expect(
    reopened.getByRole('heading', { level: 2, name: '設定', exact: true }),
  ).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await reopened.emulateMedia({ colorScheme });
    await expectNoA11yViolations(reopened);
  }
  await reopened.setViewportSize({ width: 320, height: 760 });
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
});

test('the worker uses the selected language for notifications, buttons and the toolbar tooltip', async ({
  github,
  seedStorage,
  signIn,
  poll,
  serviceWorker,
}) => {
  let failing = false;
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      [prNode({ commits: headCommit(failing ? { FAILURE: 1 } : { SUCCESS: 1 }) })],
      variables,
    ),
  );
  await seedStorage({
    settings: {
      ...defaultSettings(),
      language: 'fr',
      notifications: { ...defaultSettings().notifications, enabled: true },
    },
  });
  await signIn();
  await poll();
  await serviceWorker.evaluate(() => {
    const captured: chrome.notifications.NotificationCreateOptions[] = [];
    const create = chrome.notifications.create.bind(chrome.notifications);
    Object.defineProperty(chrome.notifications, 'create', {
      value: async (id: string, options: chrome.notifications.NotificationCreateOptions) => {
        captured.push(options);
        return create(id, options);
      },
    });
    Object.assign(globalThis, { languageNotifications: captured });
  });
  failing = true;
  await poll();
  const catalog = messages('fr');
  const notifications = await serviceWorker.evaluate(
    () =>
      (
        globalThis as unknown as {
          languageNotifications: chrome.notifications.NotificationCreateOptions[];
        }
      ).languageNotifications,
  );
  expect(notifications).toEqual([
    expect.objectContaining({
      title: catalog.ciFailed?.message,
      buttons: [{ title: catalog.open?.message }, { title: catalog.snooze1H?.message }],
    }),
  ]);
  await expect
    .poll(() => serviceWorker.evaluate(() => chrome.action.getTitle({})))
    .toContain(catalog.ciFailing?.message);
});
