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

/**
 * Dependabot may merge an Action update by itself only in workflows that hold no release
 * permission and no secret (docs/decisions.md, "Dependabot auto-merge").
 */
it('auto-merges Action updates only in workflows without release permissions or secrets', () => {
  const policy = readFileSync(resolve(dir, 'dependabot-auto-merge.yml'), 'utf8');
  const allowed = /github_actions\)\s*\n\s*allowed='([^']+)'/.exec(policy)?.[1]?.split(' ') ?? [];
  expect(allowed.length).toBeGreaterThan(0);
  for (const path of allowed) {
    const yaml = readFileSync(resolve(dir, '../..', path), 'utf8');
    expect({
      path,
      risky: /id-token: write|contents: write|secrets\.|environment:/.test(yaml),
    }).toEqual({ path, risky: false });
  }
});

/**
 * A stale pinned schema fails the weekly run (GitHub notifies the maintainer of a failed
 * scheduled run), and the workflow stays read-only: no issue, no pull request, no secret.
 */
it('fails the weekly schema check on a stale pinned copy, with read-only permissions', () => {
  const yaml = readFileSync(resolve(dir, 'github-schema.yml'), 'utf8');
  expect(yaml).toMatch(/git diff --quiet -- tests\/fixtures\/github-schema\.graphql[\s\S]*exit 1/);
  expect([...yaml.matchAll(/^\s+[a-z-]+: (write|read)$/gm)].map(([line]) => line.trim())).toEqual([
    'contents: read',
  ]);
  expect(yaml).not.toMatch(/secrets\./);
});

/**
 * Any branch's workflow run can write the Actions cache, so a workflow that deploys, publishes
 * or holds a secret restores none: a poisoned cache would reach what ships.
 */
it('restores no cache in workflows that deploy, release or hold secrets', () => {
  const files = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file));
  for (const file of files) {
    const yaml = readFileSync(resolve(dir, file), 'utf8');
    if (!/pages: write|id-token: write|contents: write|secrets\./.test(yaml)) continue;
    expect({ file, cache: /^\s*cache:|actions\/cache@/m.test(yaml) }).toEqual({
      file,
      cache: false,
    });
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
