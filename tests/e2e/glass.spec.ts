import { defaultSettings } from '../../src/lib/storage/settings';
import { prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { MOCK_ORIGIN } from './mock-github/server';

test.beforeEach(async ({ github, seedStorage, signIn, poll, context }) => {
  const nodes = Array.from({ length: 12 }, (_, index) =>
    prNode({
      number: index + 1,
      title: `Check surface ${index + 1}`,
      url: `${MOCK_ORIGIN}/acme/widgets/pull/${index + 1}`,
    }),
  );
  github.onGraphQL('ProwlSearch', (variables) => searchResponse(nodes, variables));
  await seedStorage({
    settings: { ...defaultSettings(), groupByRepo: false, hideStaleAfterDays: 0 },
  });
  await signIn();
  await poll();
  for (const page of context.pages()) await page.close();
});

test('blurs only the chrome and keeps menus inside the panel, light and dark, at 320 and 400px', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  const cards = panel.locator('.pr-card');
  await expect(cards).toHaveCount(12);
  // A filter on a card would also make it the containing block of its fixed menu.
  const blur = (selector: string, pseudo?: string) =>
    panel
      .locator(selector)
      .first()
      .evaluate((element, which) => getComputedStyle(element, which).backdropFilter, pseudo);
  expect(await blur('.header', '::after')).toContain('blur');
  expect(await blur('.pr-card')).toBe('none');
  for (const width of [400, 320]) {
    await panel.setViewportSize({ width, height: 760 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme });
      await cards
        .first()
        .getByRole('button', { name: /^More actions for/ })
        .click();
      const box = await panel.getByRole('menu').boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(760);
      }
      if (width === 320) await expectNoA11yViolations(panel);
      await panel.keyboard.press('Escape');
    }
  }
});

test('lights only the hovered surface and stops when motion is reduced', async ({ openPanel }) => {
  const panel = await openPanel();
  const card = panel.locator('.pr-card').first();
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error('Missing glass card');
  const lit = () =>
    panel.evaluate(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.pr-card, .header, .list__filter, .section-tabs',
          ),
        ].filter((element) => element.style.getPropertyValue('--light-strength')).length,
    );
  await panel.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.4);
  await expect
    .poll(() => card.evaluate((element) => element.style.getPropertyValue('--light-strength')))
    .toBe('.3');
  expect(await lit()).toBe(1);

  await panel.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(lit).toBe(0);
  await panel.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.5);
  // Let two frames run so a handler that wrongly scheduled a paint would have painted.
  await panel.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  expect(await lit()).toBe(0);
  // Without the light, hovering the summary still gives a cue.
  await expect(card.locator('.pr-card__summary')).not.toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
});
