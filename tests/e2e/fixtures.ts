import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {
  type BrowserContext,
  test as base,
  chromium,
  type Page,
  type Worker,
} from '@playwright/test';
import type { AuthState } from '../../src/lib/model';
import { MockGitHub } from './mock-github/server';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist-e2e');
/** The production build, as the store ships it (`pnpm build`). */
export const PRODUCTION_PATH = resolve(import.meta.dirname, '../../dist');
/** `pnpm screenshots`: the run that writes docs/screenshots/. */
const WRITE_SCREENSHOTS = process.env.PROWL_SCREENSHOTS === '1';

export interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** Opens the side panel document in a tab sized like a side panel. */
  openPanel: (hash?: string) => Promise<Page>;
  /** Lets running transitions end, runs axe on the page and fails on any violation. */
  expectNoA11yViolations: (page: Page) => Promise<void>;
  /** Writes keys to `chrome.storage.local` from the service worker, as the poller would. */
  seedStorage: (items: Record<string, unknown>) => Promise<void>;
  /** Stores `auth` for octocat (with `overrides`), as a sign-in would, and returns it. */
  signIn: (overrides?: Partial<AuthState>) => Promise<AuthState>;
  /** Sends `{ type: 'poll', force: true }` from an extension page; resolves once it is done. */
  poll: () => Promise<void>;
}

/** What `signIn()` stores unless overridden. The token only ever reaches the mock. */
export const E2E_AUTH: AuthState = {
  method: 'pat',
  token: 'ghp_e2e',
  tokenType: 'classic',
  scopes: ['repo'],
  viewer: {
    login: 'octocat',
    avatarUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`,
    name: 'The Octocat',
  },
  createdAt: '2026-10-06T08:00:00.000Z',
};

/**
 * Chromium with the unpacked extension in `extensionPath` loaded, in a fresh profile, once its
 * service worker is running.
 */
export async function launchExtension(extensionPath: string): Promise<BrowserContext> {
  const launch = () =>
    chromium.launchPersistentContext('', {
      channel: 'chromium',
      // Unset in CI, which uses Playwright's own Chromium. A machine that has another Chromium
      // points PROWL_CHROMIUM at it (docs/releasing.md).
      executablePath: process.env.PROWL_CHROMIUM || undefined,
      headless: !process.env.HEADED,
      viewport: { width: 400, height: 760 },
      // The images in docs/ are shown on HiDPI screens: capture them at twice the pixel density
      // (800 x 1520). Routine runs stay at 1x, which renders four times fewer pixels.
      deviceScaleFactor: WRITE_SCREENSHOTS ? 2 : 1,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
  // On a machine under heavy load Chrome sometimes never starts the extension's service worker
  // (seen twice in a few hundred launches, both while other builds ran). A new profile fixes it,
  // so start over after a few seconds instead of waiting out the whole test timeout.
  const hasWorker = (browser: BrowserContext) =>
    browser.serviceWorkers().length > 0
      ? true
      : browser.waitForEvent('serviceworker', { timeout: 8_000 }).then(
          () => true,
          () => false,
        );
  let context = await launch();
  for (let retry = 0; retry < 2 && !(await hasWorker(context)); retry++) {
    await context.close();
    context = await launch();
  }
  return context;
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
    const context = await launchExtension(EXTENSION_PATH);
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // Chrome can report the worker before it has bound `chrome.*` to it (about 1 run in 20).
    await base.expect
      .poll(() => worker.evaluate(() => typeof chrome !== 'undefined' && !!chrome.runtime?.id), {
        intervals: [50, 100, 250],
        timeout: 5_000,
      })
      .toBe(true);
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

  seedStorage: async ({ serviceWorker }, use) => {
    await use((items) =>
      serviceWorker.evaluate((stored) => chrome.storage.local.set(stored), items),
    );
  },

  signIn: async ({ seedStorage }, use) => {
    await use(async (overrides = {}) => {
      const auth = { ...E2E_AUTH, ...overrides };
      await seedStorage({ auth });
      return auth;
    });
  },

  poll: async ({ context, extensionId }, use) => {
    // The worker cannot message itself, so an extension page (the panel document in a tab)
    // sends the request; the worker answers once the poll is done.
    let sender: Page | undefined;
    await use(async () => {
      if (!sender) {
        sender = await context.newPage();
        await sender.goto(`chrome-extension://${extensionId}/sidepanel/index.html#/`);
      }
      await sender.evaluate(() => chrome.runtime.sendMessage({ type: 'poll', force: true }));
    });
    await sender?.close();
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature.
  expectNoA11yViolations: async ({}, use) => {
    await use(async (page) => {
      // A theme switch or a new dialog starts transitions and animations (colors, opacity), and
      // axe computes contrast from whatever it finds mid-flight, so a slow runner reports
      // violations that are gone 120 ms later. Scan the settled page. Endless animations (spinner,
      // skeleton shimmer) never settle and do not change colors.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
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

/**
 * Saves a screenshot to docs/screenshots/<name>.png for the README and the site, at twice the
 * panel's CSS size (see `deviceScaleFactor` above). Only writes when PROWL_SCREENSHOTS=1
 * (`pnpm screenshots`), so routine E2E runs don't churn the committed images; the page is still
 * captured so rendering errors surface either way.
 */
export async function saveScreenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await page.screenshot({
    ...options,
    ...(WRITE_SCREENSHOTS && {
      path: resolve(import.meta.dirname, `../../docs/screenshots/${name}.png`),
    }),
  });
}
