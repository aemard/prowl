import { defaultSettings } from '../../src/lib/storage/settings';
import { prNode, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { MOCK_ORIGIN } from './mock-github/server';

test.beforeEach(async ({ github, seedStorage, signIn, poll, context }) => {
  const nodes = Array.from({ length: 100 }, (_, index) =>
    prNode({
      number: index + 1,
      title: `Check surface ${index + 1}`,
      url: `${MOCK_ORIGIN}/acme/widgets/pull/${index + 1}`,
    }),
  );
  github.onGraphQL('ProwlSearch', (variables) => searchResponse(nodes, variables));
  await seedStorage({
    settings: {
      ...defaultSettings(),
      maxPerSection: 100,
      groupByRepo: false,
      hideStaleAfterDays: 0,
    },
  });
  await signIn();
  await poll();
  for (const page of context.pages()) await page.close();
});

test('keeps a large glass list readable and menus in the viewport at 320 and 400px', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();
  const cards = panel.locator('.pr-card');
  await expect(cards).toHaveCount(100);
  await expect
    .poll(() => panel.evaluate(() => performance.getEntriesByName('prowl:list-rendered').length))
    .toBe(1);
  const renderMs = await panel.evaluate(
    () => performance.getEntriesByName('prowl:list-rendered')[0]?.startTime,
  );
  test.info().annotations.push({ type: '100-card-render-ms', description: String(renderMs) });
  console.log(`100-card cached render (ms): ${renderMs?.toFixed(0)}`);
  // Observe the blur cost without a hardware-dependent scroll-FPS gate on shared CI runners.
  const scrollFrames = () =>
    panel.evaluate(async () => {
      const times: number[] = [];
      let previous = performance.now();
      for (let frame = 0; frame < 30; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        if (frame > 4) times.push(now - previous);
        previous = now;
        window.scrollTo(0, frame * 100);
      }
      window.scrollTo(0, 0);
      return times.reduce((sum, time) => sum + time, 0) / times.length;
    });
  const blurred = await scrollFrames();
  await panel.evaluate(() =>
    document.documentElement.style.setProperty('--glass-card-blur', 'none'),
  );
  const unblurred = await scrollFrames();
  await panel.evaluate(() => document.documentElement.style.removeProperty('--glass-card-blur'));
  console.log(
    `100-card scroll frame mean (ms), blur/without blur: ${blurred.toFixed(1)}/${unblurred.toFixed(1)}`,
  );
  test.info().annotations.push({
    type: '100-card-scroll-frame-ms',
    description: `${blurred.toFixed(1)}/${unblurred.toFixed(1)}`,
  });
  for (const width of [400, 320]) {
    await panel.setViewportSize({ width, height: 760 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme });
      const first = cards.first();
      const styles = await first.evaluate((element) => {
        const card = getComputedStyle(element);
        return {
          blur: card.backdropFilter,
          transform: card.transform,
          isolation: card.isolation,
          zIndex: card.zIndex,
          surfaceBlur: getComputedStyle(element, '::before').backdropFilter,
          backgrounds: (
            getComputedStyle(document.body).backgroundImage.match(/radial-gradient/g) ?? []
          ).length,
        };
      });
      expect(styles).toMatchObject({
        blur: 'none',
        transform: 'none',
        isolation: 'auto',
        zIndex: 'auto',
        backgrounds: 4,
      });
      expect(styles.surfaceBlur).toContain('blur(18px)');
      await first.getByRole('button', { name: /^More actions for/ }).click();
      const menu = panel.getByRole('menu');
      const box = await menu.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(760);
      }
      await expectNoA11yViolations(panel);
      await panel.keyboard.press('Escape');
      await panel.screenshot({ path: test.info().outputPath(`glass-${colorScheme}-${width}.png`) });
    }
  }
});

test('reflects only on the hovered surface and stops when motion is reduced', async ({
  openPanel,
}) => {
  const panel = await openPanel();
  const card = panel.locator('.pr-card').first();
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error('Missing glass card');
  await panel.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.4);
  await expect
    .poll(() => card.evaluate((el) => el.style.getPropertyValue('--light-strength')))
    .toBe('.3');
  const reflecting = () =>
    panel.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('.pr-card')].filter((el) =>
          el.style.getPropertyValue('--light-strength'),
        ).length,
    );
  expect(await reflecting()).toBe(1);
  await panel.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(reflecting).toBe(0);
  await panel.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.5);
  expect(await reflecting()).toBe(0);
});
