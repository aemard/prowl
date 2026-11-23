// @vitest-environment node
/**
 * Contract test: every GraphQL operation Prowl sends is valid against GitHub's published schema
 * (`tests/fixtures/github-schema.graphql`, refreshed by `pnpm schema:update`). The E2E mock
 * answers whatever it is asked, so only this catches a misspelt field, a wrong argument type or a
 * field GitHub removed. Deprecated fields fail too: GitHub announces removals by deprecating.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSchema, NoDeprecatedCustomRule, parse, specifiedRules, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { SEARCH_QUERY, TEAM_SEARCH_QUERY, withoutStacks } from '../../src/lib/github/queries';

const modules = import.meta.glob<Record<string, unknown>>(
  ['../../src/lib/github/**/*.ts', '!**/*.test.ts', '!**/*.test-support.ts'],
  { eager: true },
);
const sources = import.meta.glob<string>(
  ['../../src/lib/github/**/*.ts', '!**/*.test.ts', '!**/*.test-support.ts'],
  { query: '?raw', import: 'default', eager: true },
);

const schema = buildSchema(
  readFileSync(resolve(import.meta.dirname, '../fixtures/github-schema.graphql'), 'utf8'),
);

/** Every exported operation document by export name (two exports can share an operation). */
const operations = new Map<string, string>();
const names = new Set<string>();
for (const exported of Object.values(modules)) {
  for (const [key, value] of Object.entries(exported)) {
    if (typeof value !== 'string') continue;
    const name = /^\s*(?:query|mutation)\s+(\w+)/.exec(value)?.[1];
    if (!name) continue;
    operations.set(key, value);
    names.add(name);
  }
}
// The searches sent once GitHub drops its stack fields (`fetchSearch.ts`) are built, not exported.
for (const [key, query] of Object.entries({ SEARCH_QUERY, TEAM_SEARCH_QUERY }))
  operations.set(`withoutStacks(${key})`, withoutStacks(query));

describe('GraphQL operations against the GitHub schema', () => {
  it('exports every operation written in src/lib/github', () => {
    const written = Object.values(sources).flatMap((source) =>
      [...source.matchAll(/\b(?:query|mutation)\s+(Prowl\w+)/g)].map(([, name]) => name),
    );
    expect(written.length).toBeGreaterThan(10);
    // The review mutations are built from a name, so the source scan cannot see them.
    expect([...names]).toEqual(
      expect.arrayContaining([...written, 'ProwlApprove', 'ProwlRequestChanges']),
    );
  });

  it('strips the stack fields from both searches', () => {
    for (const key of ['SEARCH_QUERY', 'TEAM_SEARCH_QUERY'])
      expect(operations.get(`withoutStacks(${key})`)).not.toMatch(/stackEntry/);
  });

  it.each([...operations])('%s is valid and uses no deprecated field', (_, document) => {
    const errors = validate(schema, parse(document), [...specifiedRules, NoDeprecatedCustomRule]);
    expect(errors.map((error) => error.message)).toEqual([]);
  });

  it('fails an operation that selects a field GitHub does not have', () => {
    const errors = validate(schema, parse('query X { viewer { login notAField } }'));
    expect(errors.map((error) => error.message)).toEqual([
      'Cannot query field "notAField" on type "User".',
    ]);
  });
});
