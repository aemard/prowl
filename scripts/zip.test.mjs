import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, expect, it } from 'vitest';
import { pack } from './zip.mjs';

const dist = mkdtempSync(join(tmpdir(), 'zip-'));
mkdirSync(join(dist, 'assets'));
mkdirSync(join(dist, '.vite'));
writeFileSync(join(dist, 'manifest.json'), '{}');
writeFileSync(join(dist, 'assets/app.js'), 'console.log(1)');
writeFileSync(join(dist, 'assets/app.js.map'), '{}');
writeFileSync(join(dist, '.vite/manifest.json'), '{}');

const tz = process.env.TZ;
afterEach(() => {
  process.env.TZ = tz;
});

const packIn = (zone) => {
  process.env.TZ = zone;
  return Buffer.from(pack(dist).bytes).toString('hex');
};

it('builds the same zip in every timezone', () => {
  const utc = packIn('UTC');
  for (const zone of ['Europe/Paris', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    expect(packIn(zone)).toBe(utc);
  }
});

it('stamps every entry 2020-01-01 00:00 and leaves tooling files out', () => {
  process.env.TZ = 'Europe/Paris';
  const { bytes } = pack(dist);
  expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['assets/app.js', 'manifest.json']);
  // DOS time 00:00:00 and date 2020-01-01 at offsets 10 and 12 of the first local header.
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  expect(view.getUint16(10, true)).toBe(0);
  expect(view.getUint16(12, true)).toBe(((2020 - 1980) << 9) | (1 << 5) | 1);
});
