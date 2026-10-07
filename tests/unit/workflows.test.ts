// @vitest-environment node
/**
 * Prowl is a public repository, where GitHub's standard hosted runners are free and unlimited.
 * Larger runners are billed and self-hosted ones need machines, so every job stays on a standard
 * Ubuntu runner (docs/decisions.md).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const dir = resolve(import.meta.dirname, '../../.github/workflows');
/** Standard GitHub-hosted Ubuntu labels; lists, groups and expressions do not match. */
const FREE_RUNNER = /^ubuntu-(latest|\d{2}\.\d{2})(-arm)?$/;

it('runs every workflow job on a free GitHub-hosted runner', () => {
  const files = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const yaml = readFileSync(resolve(dir, file), 'utf8');
    for (const [, label] of yaml.matchAll(/^\s*runs-on:\s*(.+?)\s*$/gm)) {
      expect({ file, label }).toEqual({ file, label: expect.stringMatching(FREE_RUNNER) });
    }
  }
});

it('rejects runners that are billed or self-hosted', () => {
  for (const label of ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-24.04-arm']) {
    expect(label).toMatch(FREE_RUNNER);
  }
  for (const label of [
    'self-hosted',
    '[self-hosted, linux]',
    'ubuntu-latest-4-cores',
    'ubuntu-24.04-16core',
    'group: large',
  ]) {
    expect(label).not.toMatch(FREE_RUNNER);
  }
});
