// Fails when a file outgrows its line limit (ESLint `max-lines` practice, counted like `wc -l`).
// Files already over their limit sit in BASELINE at their current size: they may shrink but never
// grow, and leave the list as soon as they fit. The list only ever shrinks.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const ROOTS = ['src', 'scripts', 'tests', 'site/src'];
const CODE = /\.(ts|tsx|mjs|js|css|astro)$/;
const TEST = /\.(test|spec)\.\w+$|^tests\/fixtures\//;
const HINT = 'Split it by responsibility (see CLAUDE.md).';
const EDIT = 'BASELINE in scripts/check-file-size.mjs';

/** Path (from the repository root) -> its line count when it was last lowered. */
export const BASELINE = {
  'site/src/styles/site.css': 681,
  'src/lib/model.ts': 418,
  'src/sidepanel/views/List.test.tsx': 945,
  'src/sidepanel/views/List.tsx': 462,
  'tests/e2e/list.spec.ts': 850,
};

export const limitFor = (path) => (TEST.test(path) ? 800 : 400);

/** One message per violation; `counts` maps a path to its number of lines. */
export function findProblems(counts, baseline = BASELINE) {
  const problems = [];
  for (const [path, lines] of Object.entries(counts)) {
    const limit = limitFor(path);
    const allowed = baseline[path];
    const where = `${path}: ${lines} lines`;
    if (allowed === undefined) {
      if (lines > limit) problems.push(`${where}, limit ${limit}. ${HINT}`);
    } else if (lines <= limit) {
      problems.push(`${where}, limit ${limit}. It fits now: remove it from ${EDIT}.`);
    } else if (lines > allowed) {
      problems.push(`${where}, baseline ${allowed}, limit ${limit}. ${HINT}`);
    } else if (lines < allowed) {
      problems.push(`${where}, baseline ${allowed}. It shrank: lower it to ${lines} in ${EDIT}.`);
    }
  }
  for (const path of Object.keys(baseline)) {
    if (!(path in counts)) problems.push(`${path}: not found. Remove it from ${EDIT}.`);
  }
  return problems;
}

const countLines = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

function collect() {
  const counts = {};
  for (const dir of ROOTS) {
    for (const entry of readdirSync(resolve(root, dir), { recursive: true })) {
      const path = `${dir}/${entry.split('\\').join('/')}`;
      if (CODE.test(path)) counts[path] = countLines(readFileSync(resolve(root, path), 'utf8'));
    }
  }
  return counts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const counts = collect();
  const problems = findProblems(counts);
  for (const problem of problems) console.error(`FAIL ${problem}`);
  if (problems.length) {
    console.error('\nFile length limits: scripts/check-file-size.mjs (400 lines, tests 800).');
    process.exit(1);
  }
  console.log(
    `ok   ${Object.keys(counts).length} files within their limit (${Object.keys(BASELINE).length} baselined)`,
  );
}
