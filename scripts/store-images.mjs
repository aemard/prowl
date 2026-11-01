// Renders the Chrome Web Store listing images into docs/store/: five 1280 x 800 screenshots, the
// 440 x 280 small promo tile and the 1400 x 560 marquee. They frame the real panel from
// docs/screenshots (captured at 2x, 800 x 1520, and drawn at their 400 x 760 CSS size, so the
// browser downsamples them 2:1) with the logo and colors from tokens.css. The store wants exact
// pixel sizes, so these pages render at 1x.
// Usage: pnpm screenshots, then pnpm store-images (commit the PNGs). Headlines use Inter when
// it is installed, else the system UI font.
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'docs/store');
const dataUrl = (path, type) =>
  `data:${type};base64,${readFileSync(resolve(root, path)).toString('base64')}`;
const logo = dataUrl('docs/brand/prowl-logo-transparent.png', 'image/png');
const shot = (name) => dataUrl(`docs/screenshots/${name}.png`, 'image/png');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');

const style = `
${tokens}
* { box-sizing: border-box; margin: 0; }
body { width: 100vw; height: 100vh; overflow: hidden; font-family: Inter, var(--font-sans);
  color: var(--color-fg); -webkit-font-smoothing: antialiased; }
.canvas { position: relative; display: flex; align-items: center; width: 100%; height: 100%;
  overflow: hidden; background: var(--color-brand-mint); }
.copy { display: flex; flex-direction: column; gap: 20px; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 600; }
h1 { font-family: "Inter Display", Inter, var(--font-sans); font-size: 56px; line-height: 1.08;
  font-weight: 600; letter-spacing: -0.02em; text-wrap: balance; }
p { font-size: 24px; line-height: 1.4; color: var(--color-fg-muted); text-wrap: pretty; }
.panel { flex: none; overflow: hidden; border: 1px solid var(--color-border); border-radius: 14px;
  background: var(--gray-1); box-shadow: var(--shadow-lg); }
.panel img { display: block; }
.marquee { padding: 44px 87px; gap: 90px; }
.marquee .copy { width: 610px; flex: none; gap: 0; }
.marquee .brand { gap: 16px; font-size: 37px; font-weight: 700;
  letter-spacing: -0.04em; height: 88px; margin-left: -13px; }
.marquee h1 { margin: 26px 0 18px; font-size: 61px; line-height: 1.08;
  letter-spacing: -0.04em; font-weight: 600; text-wrap: initial; }
.marquee p { font-size: 23px; line-height: 1.5; }
.trust { display: flex; align-items: center; gap: 18px; margin-top: 31px;
  font-size: 15px; color: var(--color-fg-muted); white-space: nowrap; }
.trust span + span::before { content: '·'; margin-right: 18px; }
.trust .open { color: var(--color-accent-fg); font-weight: 600; }
.hero-product { flex: 1; margin-top: 14px; }
.hero-label { font-size: 12px; letter-spacing: 0.15em; color: var(--color-fg-muted);
  margin: 0 0 27px 19px; }
.hero-preview { width: 452px; padding: 15px; border: 1px solid var(--color-border);
  border-radius: 30px; background: var(--color-bg); box-shadow: var(--shadow-lg); }
.hero-crop { height: 290px; overflow: hidden; border-radius: 20px; }
.hero-crop img { display: block; }
.hero-caption { display: flex; justify-content: space-between; font-size: 12px;
  color: var(--color-fg-muted); margin: 19px 7px 4px; }
`;

/** The panel cut to `height` from the top; list shots show it whole, section bar included. */
const panel = (name, height = 720) =>
  `<div class="panel" style="height:${height}px"><img src="${shot(name)}" width="400" height="760" alt=""></div>`;

/** A 1280 x 800 screenshot: headline and line of copy on the left, the real panel on the right. */
const screenshot = (title, text, panels) => `
  <div class="canvas" style="gap:72px;padding:0 96px">
    <div class="copy" style="flex:1">
      <div class="brand"><img src="${logo}" width="44" height="44" alt="">Prowl <span style="font-size:14px;letter-spacing:0.08em;margin-left:auto">OPEN SOURCE</span></div>
      <h1>${title}</h1>
      <p>${text}</p>
    </div>
    <div style="display:flex;gap:24px">${panels}</div>
  </div>`;

const IMAGES = [
  {
    file: 'promo-social.png',
    size: [1200, 630],
    html: `<div class="canvas" style="padding:48px 64px;gap:64px">
      <div class="copy" style="flex:1"><div class="brand"><img src="${logo}" width="72" height="72" alt="">Prowl</div>
      <h1 style="font-size:60px">A quiet eye on your pull requests.</h1>
      <p>Open source. GitHub PRs.<br>Right in Chrome’s side panel.</p></div>
      ${panel('list-light', 530)}
    </div>`,
  },
  {
    file: 'screenshot-1-list.png',
    size: [1280, 800],
    html: screenshot(
      'A quiet eye on your pull requests.',
      'The open source GitHub PR manager for Chrome. CI, reviews and merge status, right beside your work.',
      panel('list-light', 760),
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
          <div class="brand"><img src="${logo}" width="44" height="44" alt="">Prowl <span style="font-size:14px;letter-spacing:0.08em;margin-left:auto">OPEN SOURCE</span></div>
          <h1 style="font-size:46px">Follows your theme</h1>
          <p style="font-size:20px">Light or dark, like your system. Change it in Settings.</p>
        </div>
        <div style="display:flex;gap:24px">${panel('list-light', 760)}${panel('list-dark', 760)}</div>
      </div>`,
  },
  {
    file: 'screenshot-5-sign-in.png',
    size: [1280, 800],
    html: screenshot(
      'Your PRs. Your data.',
      'Sign in with GitHub. No Prowl backend, no telemetry. Your token stays on your device and is sent only to GitHub.',
      panel('device-flow'),
    ),
  },
  {
    // Keep the tile simple and recognizable at half size: the logo alone.
    file: 'promo-small.png',
    size: [440, 280],
    html: `
      <div class="canvas" style="justify-content:center">
        <img src="${logo}" width="256" height="256" alt="">
      </div>`,
  },
  {
    file: 'promo-marquee.png',
    size: [1400, 560],
    html: `
      <div class="canvas marquee">
        <div class="copy">
          <div class="brand">
            <img src="${logo}" width="104" height="104" alt="">Prowl
          </div>
          <h1>Your pull requests.<br>A little calmer.</h1>
          <p>CI, reviews and merge status.<br>Right in Chrome’s side panel.</p>
          <div class="trust"><span class="open">● &nbsp;Open source</span><span>MIT licensed</span><span>No tracking</span></div>
        </div>
        <div class="hero-product">
          <div class="hero-label">YOUR GITHUB PRs, AT A GLANCE</div>
          <div class="hero-preview">
            <div class="hero-crop"><img src="${shot('list-ready')}" width="420" height="798" alt="Prowl showing a pull request ready to merge"></div>
            <div class="hero-caption"><span>Light theme</span><span>Chrome side panel</span></div>
          </div>
        </div>
      </div>`,
  },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PROWL_CHROMIUM || undefined });
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
