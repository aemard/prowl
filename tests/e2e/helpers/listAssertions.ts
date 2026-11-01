import type { Locator, Page, Worker } from '@playwright/test';
import type { PrLocalState, Section } from '../../../src/lib/model';
import { defaultSettings } from '../../../src/lib/storage/settings';
import { prId } from '../../fixtures/github';
import { expect } from '../fixtures';

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

export const customSection = (id: string, label: string): Section => ({
  id,
  kind: 'custom',
  label,
  enabled: true,
  query: 'label:none',
});

export const sectionBarFits = (panel: Page) =>
  panel.evaluate(() => {
    const page = document.documentElement;
    const items = [...document.querySelectorAll('[data-bottom-bar] button')];
    return (
      page.scrollWidth <= page.clientWidth &&
      items.every((item) => {
        const { left, right } = item.getBoundingClientRect();
        return left >= 0 && right <= page.clientWidth;
      })
    );
  });

export async function expectSectionBarWidths(panel: Page) {
  for (const width of [600, 400, 320]) {
    await panel.setViewportSize({ width, height: 760 });
    expect(await sectionBarFits(panel), `${width} px`).toBe(true);
  }
}

export async function expectRepositoryKeyboardFolding(
  panel: Page,
  header: (repo: string) => Locator,
  rateLimit: RegExp,
) {
  // Folding: no cards, still counted, state on the button; Space does it from the keyboard.
  await header('acme/api').focus();
  await panel.keyboard.press('Space');
  await expect(header('acme/api')).toHaveAttribute('aria-expanded', 'false');
  await expect(cardFor(panel, rateLimit)).toHaveCount(0);
  // Five groups and five cards: the folded group's two are gone.
  await expect(panel.getByRole('listitem')).toHaveCount(5 + 5);
  await expect(panel.getByRole('tab', { selected: true })).toHaveText('Mine7');
  await expect(header('acme/api')).toBeFocused();

  // j / k go from card to card across the headers, past the folded group.
  await panel.getByRole('button', { name: /^Details for Dark mode: fix contrast/ }).focus();
  await panel.keyboard.press('j');
  await expect(
    panel.getByRole('button', { name: /^Details for Fix crash when rotating/ }),
  ).toBeFocused();
  await panel.keyboard.press('k');
  await expect(panel.getByRole('button', { name: /^Details for Dark mode/ })).toBeFocused();
  await header('acme/api').focus();
  await panel.keyboard.press('j');
  await expect(
    panel.getByRole('button', { name: /^Details for Fix crash when rotating/ }),
  ).toBeFocused();
}

export async function enableRepositoryGrouping(panel: Page) {
  // Its own switch in Settings, apart from the sort order.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const grouping = panel.getByRole('switch', { name: 'Group pull requests by repository' });
  await expect(grouping).toHaveAttribute('aria-checked', 'false');
  await expect(panel.getByLabel('Sort pull requests by')).toHaveValue('updated');
  await grouping.click();
  await expect(grouping).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByLabel('Sort pull requests by')).toHaveValue('updated');
  await panel.getByRole('button', { name: 'Back to pull requests' }).click();
}
