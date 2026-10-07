// @vitest-environment node
/** The committed images keep the sizes the README, the site and the Chrome Web Store depend on. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const docs = resolve(import.meta.dirname, '../../docs');

/** Pixel size from the PNG header (the IHDR chunk follows the 8-byte signature). */
function pngSize(dir: string, file: string): [number, number] {
  const png = readFileSync(resolve(docs, dir, file));
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

const pngs = (dir: string) =>
  readdirSync(resolve(docs, dir)).filter((file) => file.endsWith('.png'));

it('captures every screenshot at 2x: 800 px wide for the 400 px panel', () => {
  const files = pngs('screenshots');
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const [width, height] = pngSize('screenshots', file);
    expect([file, width]).toEqual([file, 800]);
    // The panel is 760 px tall (1520); the settings page is captured full height.
    expect(height, file).toBeGreaterThanOrEqual(1520);
  }
});

it('renders the store listing images at the exact sizes the store asks for', () => {
  const sizes: Record<string, [number, number]> = {
    'promo-small.png': [440, 280],
    'promo-marquee.png': [1400, 560],
  };
  const files = pngs('store');
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect([file, pngSize('store', file)]).toEqual([file, sizes[file] ?? [1280, 800]]);
  }
});
