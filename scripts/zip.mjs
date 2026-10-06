// Packs dist/ into prowl-v<version>.zip, ready to "Load unpacked" or upload.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, process.argv[2] ?? 'dist');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const out = resolve(root, `prowl-v${version}.zip`);

/** Files produced for tooling only; they must not ship. */
const EXCLUDED = [/^\.vite\//, /\.map$/];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = {};
for (const path of walk(dist).sort()) {
  const rel = relative(dist, path).split('\\').join('/');
  if (EXCLUDED.some((re) => re.test(rel))) continue;
  // Fixed mtime keeps the archive reproducible.
  files[rel] = [readFileSync(path), { mtime: new Date('2020-01-01T00:00:00Z') }];
}
if (!files['manifest.json']) throw new Error(`No manifest.json in ${dist}. Run pnpm build first.`);

writeFileSync(out, zipSync(files, { level: 9 }));
console.log(
  `${relative(root, out)} (${Object.keys(files).length} files, ${statSync(out).size} bytes)`,
);
