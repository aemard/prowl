// Enforces perf-budget.json against the Vite build manifest (dist/.vite/manifest.json).
// For each entry, sums the gzipped size of the entry chunk plus its static imports and CSS.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, process.argv[2] ?? 'dist');
const manifestPath = resolve(dist, '.vite/manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`Missing ${manifestPath}. Run pnpm build first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const budget = JSON.parse(readFileSync(resolve(root, 'perf-budget.json'), 'utf8'));
const gz = (file) => gzipSync(readFileSync(resolve(dist, file))).length;

function collect(key, seen = new Set()) {
  if (seen.has(key)) return { js: new Set(), css: new Set() };
  seen.add(key);
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Unknown manifest entry: ${key}`);
  const js = new Set(chunk.file.endsWith('.js') ? [chunk.file] : []);
  const css = new Set(chunk.css ?? []);
  for (const dep of chunk.imports ?? []) {
    const sub = collect(dep, seen);
    for (const f of sub.js) js.add(f);
    for (const f of sub.css) css.add(f);
  }
  return { js, css };
}

let failed = false;
const report = (label, size, limit) => {
  const ok = size <= limit;
  failed ||= !ok;
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(36)} ${kb(size).padStart(9)} / ${kb(limit)}`);
};

for (const [entry, limits] of Object.entries(budget.entries)) {
  const { js, css } = collect(entry);
  if (limits.js !== undefined)
    report(
      `${entry} js (gzip)`,
      [...js].reduce((s, f) => s + gz(f), 0),
      limits.js,
    );
  if (limits.css !== undefined)
    report(
      `${entry} css (gzip)`,
      [...css].reduce((s, f) => s + gz(f), 0),
      limits.css,
    );
}

// Approximate the shipped archive: every file except tooling output, gzipped.
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === '.vite' ? [] : walk(p)) : [p];
  });
report(
  'extension total (gzip)',
  walk(dist).reduce((s, p) => s + gzipSync(readFileSync(p)).length, 0),
  budget.zip,
);

if (failed) {
  console.error('\nPerformance budget exceeded. See perf-budget.json.');
  process.exit(1);
}
