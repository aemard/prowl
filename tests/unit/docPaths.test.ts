// @vitest-environment node
/**
 * The docs and agent guides send readers to files: a path that no longer exists sends them
 * nowhere. Every file path they cite in code font, or spelled from a source folder, must exist,
 * either from the repository root, next to the doc, or as the end of a real path
 * (`state/store.ts` for `src/sidepanel/state/store.ts`). `decisions.md` is history and may name
 * files that are gone.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-e2e', '.git', '.astro', 'test-results']);

function walk(dir: string, keep: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(path, keep);
    return keep(path) ? [relative(root, path)] : [];
  });
}

const DOCS = [
  ...walk(join(root, 'docs'), (path) => path.endsWith('.md') && !path.endsWith('decisions.md')),
  ...walk(join(root, '.claude/agents'), (path) => path.endsWith('.md')),
  'README.md',
  'CONTRIBUTING.md',
  'CLAUDE.md',
];

const FILES = ['src', 'tests', 'scripts', 'site', 'public', 'docs', '.github'].flatMap((dir) =>
  walk(join(root, dir), () => true),
);

const EXTENSION = '\\.(?:tsx|ts|mjs|css|json|md|astro|html|ya?ml|png|graphql)(?![\\w-])';
/** `state/store.ts`, `src/lib/model.ts`; not `foo.ts` (a bare name is an example or a module). */
const QUOTED = new RegExp(`\`([\\w.-]*/[\\w./-]+${EXTENSION})\``, 'g');
const SPELLED = new RegExp(
  `(?<![\\w/.-])((?:src|tests|scripts|site/src)/[\\w./-]+${EXTENSION})`,
  'g',
);

/** The file paths `text` cites. */
function citedPaths(text: string): string[] {
  const paths = [...text.matchAll(QUOTED), ...text.matchAll(SPELLED)].map((match) => match[1]);
  return [...new Set(paths.filter((path): path is string => path !== undefined))];
}

function exists(path: string, doc: string): boolean {
  const bare = path.replace(/^\.\//, '');
  return (
    existsSync(resolve(root, bare)) ||
    existsSync(resolve(root, dirname(doc), path)) ||
    FILES.some((file) => file.endsWith(`/${bare}`))
  );
}

describe('paths cited in docs', () => {
  it('finds quoted and spelled paths, not bare names', () => {
    expect(
      citedPaths('Use `state/store.ts`, see src/lib/model.ts. `foo.ts` and `a/*.md` are not.'),
    ).toEqual(['state/store.ts', 'src/lib/model.ts']);
  });

  it.each(DOCS)('%s cites only files that exist', (doc) => {
    const missing = citedPaths(readFileSync(resolve(root, doc), 'utf8')).filter(
      (path) => !exists(path, doc),
    );
    expect(missing).toEqual([]);
  });
});
