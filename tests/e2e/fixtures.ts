import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {
  type BrowserContext,
  test as base,
  chromium,
  type Page,
  type Worker,
} from '@playwright/test';
import { MockGitHub } from './mock-github/server';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist-e2e');

export interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** Opens the side panel document in a tab sized like a side panel. */
  openPanel: (hash?: string) => Promise<Page>;
  /** Runs axe on the page and fails on any violation. */
  expectNoA11yViolations: (page: Page) => Promise<void>;
}

export const test = base.extend<ExtensionFixtures, { github: MockGitHub }>({
  github: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature.
    async ({}, use) => {
      const github = new MockGitHub();
      await github.start();
      await use(github);
      await github.stop();
    },
    { scope: 'worker' },
  ],

  context: async ({ github }, use) => {
    github.reset();
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 400, height: 760 },
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  openPanel: async ({ context, extensionId }, use) => {
    await use(async (hash = '') => {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`chrome-extension://${extensionId}/sidepanel/index.html${hash}`);
      page.on('close', () => {
        if (errors.length > 0)
          throw new Error(`Uncaught errors in side panel:\n${errors.join('\n')}`);
      });
      return page;
    });
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature.
  expectNoA11yViolations: async ({}, use) => {
    await use(async (page) => {
      const results = await new AxeBuilder({ page }).analyze();
      const summary = results.violations.map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
      );
      base.expect(summary, 'axe violations').toEqual([]);
    });
  },
});

export const expect = test.expect;

/** Saves a screenshot to docs/screenshots/<name>.png for the README and the site. */
export async function saveScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: resolve(import.meta.dirname, `../../docs/screenshots/${name}.png`),
  });
}
