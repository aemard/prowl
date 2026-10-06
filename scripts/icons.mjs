// Rasterizes src/assets/logo.svg into the PNG icons Chrome requires.
// Usage: pnpm icons   (commit the generated PNGs)
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(resolve(root, 'src/assets/logo.svg'), 'utf8');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = svg.replace('<svg', `<svg width="${size}" height="${size}"`);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
    );
    await page.screenshot({ path: resolve(outDir, `icon-${size}.png`), omitBackground: true });
    await page.close();
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
