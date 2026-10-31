import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(18, 18, 21)';

const look = (page: Page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      background: getComputedStyle(document.body).backgroundColor,
      colorScheme: root.colorScheme,
    };
  });

const setTheme = (page: Page, theme: 'light' | 'dark' | null) =>
  page.evaluate((t) => {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }, theme);

test('follows the system theme unless data-theme forces one', async ({
  openPanel,
  expectNoA11yViolations,
}) => {
  const panel = await openPanel();

  await panel.emulateMedia({ colorScheme: 'light' });
  expect(await look(panel)).toEqual({ background: LIGHT_BG, colorScheme: 'light' });
  await expectNoA11yViolations(panel);

  await panel.emulateMedia({ colorScheme: 'dark' });
  expect(await look(panel)).toEqual({ background: DARK_BG, colorScheme: 'dark' });
  await expectNoA11yViolations(panel);

  await setTheme(panel, 'light');
  expect(await look(panel)).toEqual({ background: LIGHT_BG, colorScheme: 'light' });

  await panel.emulateMedia({ colorScheme: 'light' });
  await setTheme(panel, 'dark');
  expect(await look(panel)).toEqual({ background: DARK_BG, colorScheme: 'dark' });
  await expectNoA11yViolations(panel);

  await setTheme(panel, null);
  expect(await look(panel)).toEqual({ background: LIGHT_BG, colorScheme: 'light' });
});

test('collapses motion tokens under prefers-reduced-motion', async ({ openPanel }) => {
  const panel = await openPanel();
  const durations = () =>
    panel.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return ['--duration-fast', '--duration-normal', '--duration-spin'].map((name) =>
        root.getPropertyValue(name).trim(),
      );
    });
  // The minifier may rewrite units (120ms -> .12s), so compare as milliseconds.
  const ms = (values: string[]) =>
    values.map((v) => (v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000));

  await panel.emulateMedia({ reducedMotion: 'no-preference' });
  expect(ms(await durations())).toEqual([120, 180, 800]);
  await panel.emulateMedia({ reducedMotion: 'reduce' });
  expect(ms(await durations())).toEqual([0, 0, 1600]);
});

test('ships toolbar icons at every manifest size', async ({ openPanel, serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.action?.default_icon).toEqual(manifest.icons);
  const panel = await openPanel();
  const sizes = await panel.evaluate(
    (icons) =>
      Promise.all(
        Object.entries(icons).map(
          ([size, path]) =>
            new Promise<[string, number]>((done, fail) => {
              const img = new Image();
              img.onload = () => done([size, img.naturalWidth]);
              img.onerror = () => fail(new Error(`missing ${path}`));
              img.src = `/${path}`;
            }),
        ),
      ),
    manifest.icons ?? {},
  );
  expect(sizes).toEqual([
    ['16', 16],
    ['32', 32],
    ['48', 48],
    ['128', 128],
  ]);
});

test('keeps glass surfaces opaque when reduced transparency is requested', async ({
  github,
  signIn,
  poll,
  openPanel,
  expectNoA11yViolations,
}) => {
  const { prNode, searchResponse } = await import('../fixtures/github');
  github.onGraphQL('ProwlSearch', (variables) => searchResponse([prNode()], variables));
  await signIn();
  await poll();
  const panel = await openPanel();
  await expect(panel.locator('.pr-card')).toHaveCount(1);
  const session = await panel.context().newCDPSession(panel);
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(panel, theme);
    const surfaces = await panel.evaluate(() => {
      const sample = document.createElement('span');
      sample.style.backgroundColor = 'var(--glass-solid)';
      document.body.append(sample);
      const solid = getComputedStyle(sample).backgroundColor;
      sample.remove();
      const card = document.querySelector('.pr-card');
      const header = document.querySelector('.header');
      return {
        solid,
        card: card && getComputedStyle(card).backgroundColor,
        chrome: header && getComputedStyle(header, '::after').backgroundColor,
        blur: header && getComputedStyle(header, '::after').backdropFilter,
      };
    });
    expect(surfaces.card).toBe(surfaces.solid);
    expect(surfaces.chrome).toBe(surfaces.solid);
    expect(surfaces.blur).toBe('none');
    await expectNoA11yViolations(panel);
    await panel.screenshot({ path: test.info().outputPath(`glass-opaque-${theme}.png`) });
  }
});
