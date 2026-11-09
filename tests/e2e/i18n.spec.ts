import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, saveScreenshot, test } from './fixtures';
import { MOCK_ORIGIN } from './mock-github/server';

async function captureLocalizedSettings(page: Page, locale: string) {
  if (process.env.PROWL_SCREENSHOTS !== '1' || locale !== 'ja') return;
  // Show the shipped host, as the existing English settings screenshot does.
  await page.evaluate((mock) => {
    for (const name of document.querySelectorAll('.settings-permissions__name'))
      if (name.textContent === mock) name.textContent = 'api.github.com';
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  }, new URL(MOCK_ORIGIN).host);
  await page.emulateMedia({ colorScheme: 'light' });
  await saveScreenshot(page, 'settings-ja', { fullPage: true });
}

for (const locale of ['ja', 'zh-CN', 'zh-TW', 'fr', 'de', 'es', 'it']) {
  test.describe(`Chrome language ${locale}`, () => {
    test.use({ locale });
    test('localizes the manifest, onboarding and settings with navigable headings', async ({
      serviceWorker,
      openPanel,
      signIn,
      expectNoA11yViolations,
    }) => {
      const code = locale === 'it' ? 'en' : locale.replace('-', '_');
      const messages: Record<string, { message: string }> = JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, `../../public/_locales/${code}/messages.json`),
          'utf8',
        ),
      );
      const native = await serviceWorker.evaluate(() => ({
        locale: chrome.i18n.getUILanguage(),
        settings: chrome.i18n.getMessage('settings'),
        description: chrome.runtime.getManifest().description,
        formatted: chrome.i18n.getMessage('copied', ['feature/$1']),
      }));
      expect(native.locale.toLowerCase()).toBe(locale.toLowerCase());
      expect(native.settings).toBe(messages.settings?.message);
      expect(native.description).toBe(messages.extensionDescription?.message);
      expect(native.formatted).toBe(messages.copied?.message.replace('$P1$', 'feature/$1'));

      const onboarding = await openPanel();
      await expect(
        onboarding.getByRole('heading', {
          name: messages.seeYourPullRequestsHere?.message,
          exact: true,
        }),
      ).toBeVisible();
      expect(await onboarding.locator('html').getAttribute('lang')).toBe(
        messages.languageTag?.message,
      );
      await signIn();
      const settings = await openPanel('#/settings');
      await expect(
        settings.getByRole('heading', { name: messages.settings?.message, exact: true }),
      ).toBeVisible();
      await settings.locator('.settings__nav a').first().click();
      await expect(
        settings.getByRole('heading', { level: 3, name: messages.sections?.message, exact: true }),
      ).toBeFocused();
      for (const theme of ['light', 'dark'] as const) {
        await settings.emulateMedia({ colorScheme: theme });
        await expectNoA11yViolations(settings);
      }
      await captureLocalizedSettings(settings, locale);
      await settings.setViewportSize({ width: 320, height: 760 });
      expect(
        await settings.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  });
}
