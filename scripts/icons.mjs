// Rasterizes src/assets/logo.svg into the PNG icons Chrome requires.
// Usage: pnpm icons   (commit the generated PNGs)
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(resolve(root, 'src/assets/logo.svg'), 'utf8');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

// The Chrome Web Store wants 96 px of artwork inside 16 px of transparent padding at 128 px.
// Smaller sizes (toolbar, extensions page) use the full canvas so the mark stays legible.
const padding = { 128: 16 };

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const pad = padding[size] ?? 0;
    const art = size - 2 * pad;
    const sized = svg.replace('<svg', `<svg width="${art}" height="${art}" style="display:block"`);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:${pad}px;background:transparent">${sized}</body></html>`,
    );
    await page.screenshot({ path: resolve(outDir, `icon-${size}.png`), omitBackground: true });
    await page.close();
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
