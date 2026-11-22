#!/usr/bin/env node
/**
 * Lists every package the shipped artifacts are built with: the build roots below, every
 * dependency of the website (`site`, deployed by pages.yml) and everything they depend on, as
 * `name@version(peers)` from pnpm-lock.yaml. Dependabot auto-merge compares
 * this list before and after an update (docs/decisions.md, "Dependabot auto-merge"): a test tool
 * update that moves anything here, even a shared transitive package, waits for a person.
 *
 * Usage: node scripts/build-chain.mjs [pnpm-lock.yaml]. Reads the lockfile as data only; plain
 * Node, no dependency, so the workflow runs it without installing anything.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * What builds the extension (`vite.config.ts`, `vite.dev.config.ts`, `scripts/zip.mjs`) and what
 * ships in it. ponytail: a new build-time import must be added here by hand.
 */
export const BUILD_ROOTS = [
  'vite',
  '@preact/preset-vite',
  '@crxjs/vite-plugin',
  'fflate',
  'preact',
  '@preact/signals',
];

const unquote = (text) => text.trim().replace(/^'(.*)'$/, '$1');

/**
 * Each importer's resolved versions and each snapshot's dependencies, from the last YAML
 * document (pnpm 12 writes its own install first). Only the subset of YAML pnpm writes there.
 */
function readLockfile(text) {
  const doc = text.split(/^---$/m).at(-1) ?? '';
  /** Importer path → dependency name → resolved version. */
  const importers = new Map();
  const edges = new Map();
  let section = '';
  let importer = '';
  let kind = '';
  let owner = '';
  let pending = '';
  for (const line of doc.split('\n')) {
    const indent = line.search(/\S/);
    if (indent === -1) continue;
    const [key, ...rest] = line.trim().split(/:(?: |$)/);
    const value = unquote(rest.join(': '));
    if (indent === 0) section = key;
    else if (section === 'importers' && indent === 2) {
      importer = unquote(key);
      importers.set(importer, new Map());
    } else if (section === 'importers' && indent === 4) kind = key;
    else if (section === 'importers' && indent === 6) pending = unquote(key);
    else if (section === 'importers' && indent === 8 && key === 'version') {
      // The website's dev tools (Lighthouse) check it; they do not build it.
      if (importer === '.' || kind !== 'devDependencies')
        importers.get(importer)?.set(pending, value);
    } else if (section === 'snapshots' && indent === 2) {
      owner = unquote(key);
      edges.set(owner, []);
    } else if (section === 'snapshots' && indent === 6 && value) {
      edges.get(owner)?.push(`${unquote(key)}@${value}`);
    }
  }
  return { importers, edges };
}

/**
 * Sorted `name@version(peers)` of the root project's `roots`, of every non-dev dependency of the
 * `whole` importers, and of everything they depend on.
 */
export function buildChain(lockfile, roots = BUILD_ROOTS, whole = ['site']) {
  const { importers, edges } = readLockfile(lockfile);
  const project = importers.get('.') ?? new Map();
  const queue = [
    ...roots.filter((name) => project.has(name)).map((name) => [name, project.get(name)]),
    ...whole.flatMap((path) => [...(importers.get(path) ?? [])]),
  ].map(([name, version]) => `${name}@${version}`);
  const seen = new Set();
  for (let id = queue.pop(); id; id = queue.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(edges.get(id) ?? []));
  }
  return [...seen].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const chain = buildChain(readFileSync(process.argv[2] ?? 'pnpm-lock.yaml', 'utf8'));
  if (chain.length === 0) {
    console.error('No build package found in the lockfile.');
    process.exit(1);
  }
  console.log(chain.join('\n'));
}
