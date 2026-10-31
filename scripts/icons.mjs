// Generates the Chrome icons from the approved logo artwork.
// Usage: pnpm icons   (commit the generated PNGs)
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const logo = `data:image/png;base64,${readFileSync(resolve(root, 'src/assets/logo.png')).toString('base64')}`;
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

// The Chrome Web Store wants 96 px of artwork inside 16 px of transparent padding at 128 px.
// Smaller sizes (toolbar, extensions page) use the full canvas so the mark stays legible.
const padding = { 128: 16 };

const browser = await chromium.launch({ executablePath: process.env.PROWL_CHROMIUM || undefined });
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const pad = padding[size] ?? 0;
    const art = size - 2 * pad;
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:${pad}px;background:transparent"><img src="${logo}" width="${art}" height="${art}" style="display:block" alt=""></body></html>`,
    );
    await page.screenshot({ path: resolve(outDir, `icon-${size}.png`), omitBackground: true });
    await page.close();
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
