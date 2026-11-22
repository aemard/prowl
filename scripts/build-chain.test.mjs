import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildChain } from './build-chain.mjs';

/** The shape pnpm writes: its own install first, then the project's lockfile. */
const lockfile = ({ rolldown = '1.2.19', vitest = '5.1.0' } = {}) => `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.10.1
        version: 12.10.1

snapshots:

  pnpm@12.10.1: {}

---
lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vite:
        specifier: ^8.3.8
        version: 8.3.8(esbuild@0.28.2)
      vitest:
        specifier: ^5.1.0
        version: ${vitest}(vite@8.3.8(esbuild@0.28.2))

  site:
    dependencies:
      astro:
        specifier: ^6.0.0
        version: 6.0.0
    devDependencies:
      lighthouse:
        specifier: 13.6.0
        version: 13.6.0

snapshots:

  '@rolldown/pluginutils@1.0.0': {}

  esbuild@0.28.2: {}

  rolldown@${rolldown}:
    dependencies:
      '@rolldown/pluginutils': 1.0.0

  vite@8.3.8(esbuild@0.28.2):
    dependencies:
      rolldown: ${rolldown}
    optionalDependencies:
      esbuild: 0.28.2

  vitest@${vitest}(vite@8.3.8(esbuild@0.28.2)):
    dependencies:
      vite: 8.3.8(esbuild@0.28.2)
`;

it('lists the build roots, the website and everything they depend on, nothing else', () => {
  expect(buildChain(lockfile(), ['vite'])).toEqual([
    '@rolldown/pluginutils@1.0.0',
    'astro@6.0.0',
    'esbuild@0.28.2',
    'rolldown@1.2.19',
    'vite@8.3.8(esbuild@0.28.2)',
  ]);
});

it('does not move when only a test tool is updated', () => {
  expect(buildChain(lockfile({ vitest: '5.2.0' }), ['vite'])).toEqual(
    buildChain(lockfile(), ['vite']),
  );
});

it('moves when an update reaches a transitive build package', () => {
  expect(buildChain(lockfile({ rolldown: '1.2.20' }), ['vite'])).toContain('rolldown@1.2.20');
});

it('finds the build chain of the real lockfile', () => {
  const chain = buildChain(readFileSync(resolve(import.meta.dirname, '../pnpm-lock.yaml'), 'utf8'));
  for (const name of ['vite', 'rolldown', 'fflate', 'preact', '@preact/preset-vite']) {
    expect(chain.some((id) => id.startsWith(`${name}@`))).toBe(true);
  }
  for (const name of ['vitest', 'happy-dom', '@playwright/test', '@biomejs/biome', 'graphql']) {
    expect(chain.some((id) => id.startsWith(`${name}@`))).toBe(false);
  }
});
