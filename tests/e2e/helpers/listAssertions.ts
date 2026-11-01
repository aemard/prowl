import type { Locator, Page, Worker } from '@playwright/test';
import type { PrLocalState, Section } from '../../../src/lib/model';
import { defaultSettings } from '../../../src/lib/storage/settings';
import { prId } from '../../fixtures/github';

/** Every preset but Team reviews, whose data and tests live in teams.spec.ts. */
export const allSections = (): Section[] =>
  defaultSettings().sections.map((section) => ({
    ...section,
    enabled: section.kind !== 'team_review_requested',
  }));

/** Ids of the authored PRs, newest activity first (the default sort). */
export const AUTHORED = {
  checkout: prId(2481, 'acme/web'),
  rateLimit: prId(912, 'acme/api'),
  draft: prId(905, 'acme/api'),
  conflicts: prId(377, 'acme/mobile'),
  badges: prId(58, 'octo/docs'),
  deps: prId(1042, 'northwind-engineering/internal-platform-services-monorepo'),
  contrast: prId(2470, 'acme/web'),
  /** No commit for 34 days: hidden by default. */
  stale: prId(2311, 'acme/web'),
};

export const tabNames = (panel: Page) => panel.getByRole('tab').allTextContents();
export const box = async (locator: Locator) =>
  (await locator.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
/** Top and bottom edges of the section bar, in CSS px from the top of the panel. */
export const barTop = async (panel: Page) => (await box(panel.locator('[data-bottom-bar]'))).y;
export const barBottom = async (panel: Page) => {
  const bar = await box(panel.locator('[data-bottom-bar]'));
  return bar.y + bar.height;
};
export const linkFor = (panel: Page, title: RegExp) => panel.getByRole('link', { name: title });
/** The card (`li`) of the pull request whose title link matches. */
export const cardFor = (panel: Page, title: RegExp) =>
  panel.locator('.pr-card', { has: linkFor(panel, title) });
export const stored = (worker: Worker) =>
  worker.evaluate(() => chrome.storage.local.get('prLocal') as Promise<{ prLocal?: PrLocalState }>);

/** Collects what the side panel sends to the service worker. */
export async function recordMessages(worker: Worker) {
  await worker.evaluate(() => {
    const received: { type: string; prIds?: string[] }[] = [];
    Object.assign(globalThis, { received });
    chrome.runtime.onMessage.addListener((message) => {
      received.push(message);
    });
  });
  return () =>
    worker.evaluate(
      () => (globalThis as unknown as { received: { type: string; prIds?: string[] }[] }).received,
    );
}
