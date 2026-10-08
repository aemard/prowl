// Packs dist/ into prowl-v<version>.zip, ready to "Load unpacked" or upload.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

/** Files produced for tooling only; they must not ship. */
const EXCLUDED = [/^\.vite\//, /\.map$/];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Zips `dist` byte for byte the same on any machine, in any timezone. */
export function pack(dist) {
  const files = {};
  for (const path of walk(dist).sort()) {
    const rel = relative(dist, path).split('\\').join('/');
    if (EXCLUDED.some((re) => re.test(rel))) continue;
    // Zip times are local wall-clock fields, so the fixed time is built in local time too.
    files[rel] = [readFileSync(path), { mtime: new Date(2020, 0, 1) }];
  }
  if (!files['manifest.json'])
    throw new Error(`No manifest.json in ${dist}. Run pnpm build first.`);
  return { bytes: zipSync(files, { level: 9 }), count: Object.keys(files).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const out = resolve(root, `prowl-v${version}.zip`);
  const { bytes, count } = pack(resolve(root, process.argv[2] ?? 'dist'));
  writeFileSync(out, bytes);
  console.log(`${relative(root, out)} (${count} files, ${statSync(out).size} bytes)`);
}
