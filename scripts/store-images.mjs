// Renders the Chrome Web Store listing images into docs/store/: five 1280 x 800 screenshots, the
// 440 x 280 small promo tile and the 1400 x 560 marquee. They frame the real panel from
// docs/screenshots (drawn at 1:1, so it stays sharp) with the logo and colors from tokens.css.
// Usage: pnpm screenshots, then pnpm store-images (commit the PNGs). Headlines use Inter when
// it is installed, else the system UI font.
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'docs/store');
const dataUrl = (path, type) =>
  `data:${type};base64,${readFileSync(resolve(root, path)).toString('base64')}`;
const logo = dataUrl('src/assets/logo.svg', 'image/svg+xml');
const shot = (name) => dataUrl(`docs/screenshots/${name}.png`, 'image/png');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');

const style = `
${tokens}
* { box-sizing: border-box; margin: 0; }
body { width: 100vw; height: 100vh; overflow: hidden; font-family: Inter, var(--font-sans);
  color: var(--color-fg); -webkit-font-smoothing: antialiased; }
.canvas { position: relative; display: flex; align-items: center; width: 100%; height: 100%;
  overflow: hidden; background: var(--color-accent-bg); }
.canvas[data-tone="ink"] { background: var(--gray-12); color: var(--gray-1); }
.canvas[data-tone="teal"] { background: var(--color-accent-solid); color: var(--color-fg-on-accent); }
.copy { display: flex; flex-direction: column; gap: 20px; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 600; }
h1 { font-family: "Inter Display", Inter, var(--font-sans); font-size: 56px; line-height: 1.08;
  font-weight: 600; letter-spacing: -0.02em; text-wrap: balance; }
p { font-size: 24px; line-height: 1.4; color: var(--color-fg-muted); text-wrap: pretty; }
[data-tone] p { color: inherit; opacity: 0.8; }
.panel { flex: none; overflow: hidden; border: 1px solid var(--color-border); border-radius: 14px;
  background: var(--gray-1); box-shadow: var(--shadow-lg); }
.panel img { display: block; }
`;

const panel = (name, height = 720) =>
  `<div class="panel" style="height:${height}px"><img src="${shot(name)}" width="400" height="760" alt=""></div>`;

/** A 1280 x 800 screenshot: headline and line of copy on the left, the real panel on the right. */
const screenshot = (title, text, panels) => `
  <div class="canvas" style="gap:72px;padding:0 96px">
    <div class="copy" style="flex:1">
      <div class="brand"><img src="${logo}" width="44" height="44" alt="">Prowl</div>
      <h1>${title}</h1>
      <p>${text}</p>
    </div>
    <div style="display:flex;gap:24px">${panels}</div>
  </div>`;

const IMAGES = [
  {
    file: 'screenshot-1-list.png',
    size: [1280, 800],
    html: screenshot(
      'Your pull requests at a glance',
      'CI, reviews and merge state for what you opened, review or are mentioned in.',
      panel('list-light'),
    ),
  },
  {
    file: 'screenshot-2-detail.png',
    size: [1280, 800],
    html: screenshot(
      'See what blocks a merge',
      'Failing checks, missing reviews and conflicts, without opening GitHub.',
      panel('detail'),
    ),
  },
  {
    file: 'screenshot-3-merge.png',
    size: [1280, 800],
    html: screenshot(
      'Review and merge from the side panel',
      'Approve, request changes, comment, re-run failed checks or merge.',
      panel('merge-dialog'),
    ),
  },
  {
    file: 'screenshot-4-themes.png',
    size: [1280, 800],
    html: `
      <div class="canvas" style="gap:56px;padding:0 64px 0 80px">
        <div class="copy" style="flex:1">
          <div class="brand"><img src="${logo}" width="44" height="44" alt="">Prowl</div>
          <h1 style="font-size:46px">Follows your theme</h1>
          <p style="font-size:20px">Light or dark, like your system. Change it in Settings.</p>
        </div>
        <div style="display:flex;gap:24px">${panel('list-light')}${panel('list-dark')}</div>
      </div>`,
  },
  {
    file: 'screenshot-5-sign-in.png',
    size: [1280, 800],
    html: screenshot(
      'Private by design',
      'Sign in with GitHub. Your token stays in this browser and only talks to GitHub. No servers, no tracking.',
      panel('device-flow'),
    ),
  },
  {
    // Google asks for no text, saturated color and a clear shape at half size: the logo alone.
    file: 'promo-small.png',
    size: [440, 280],
    html: `
      <div class="canvas" data-tone="teal" style="justify-content:center">
        <img src="${logo}" width="176" height="176" alt="">
      </div>`,
  },
  {
    file: 'promo-marquee.png',
    size: [1400, 560],
    html: `
      <div class="canvas" data-tone="ink" style="gap:72px;padding:0 0 0 112px">
        <div class="copy" style="flex:1">
          <div class="brand" style="font-size:44px;gap:20px">
            <img src="${logo}" width="88" height="88" alt="">Prowl
          </div>
          <p style="font-size:30px">Your GitHub pull requests in Chrome's side panel.</p>
        </div>
        <div style="display:flex;gap:24px;align-self:flex-start;margin-top:72px">
          ${panel('list-light', 560)}${panel('list-dark', 560)}
        </div>
      </div>`,
  },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { file, size, html } of IMAGES) {
    const [width, height] = size;
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
      `<!doctype html><html data-theme="light"><head><style>${style}</style></head><body>${html}</body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(outDir, file) });
    await page.close();
    console.log(`docs/store/${file}`);
  }
} finally {
  await browser.close();
}
