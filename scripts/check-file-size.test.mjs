import { expect, it } from 'vitest';
import { findProblems, limitFor } from './check-file-size.mjs';

it('allows 800 lines in tests and fixtures, 400 in everything else', () => {
  for (const path of ['a.test.ts', 'a.test.tsx', 'a.test.mjs', 'tests/e2e/a.spec.ts']) {
    expect(limitFor(`src/${path}`)).toBe(800);
  }
  expect(limitFor('tests/fixtures/github.ts')).toBe(800);
  for (const path of ['src/a.ts', 'tests/e2e/fixtures.ts', 'site/src/styles/site.css']) {
    expect(limitFor(path)).toBe(400);
  }
});

it('names the file, its lines, the limit and the way out when a new file is too long', () => {
  const [problem, ...rest] = findProblems({ 'src/a.ts': 401, 'src/b.ts': 400 }, {});
  expect(rest).toEqual([]);
  expect(problem).toBe(
    'src/a.ts: 401 lines, limit 400. Split it by responsibility (see CLAUDE.md).',
  );
});

it('lets a baselined file stay as it is, and neither grow nor shrink unnoticed', () => {
  const baseline = { 'src/a.ts': 500 };
  expect(findProblems({ 'src/a.ts': 500 }, baseline)).toEqual([]);
  expect(findProblems({ 'src/a.ts': 501 }, baseline)[0]).toContain('baseline 500, limit 400');
  expect(findProblems({ 'src/a.ts': 450 }, baseline)[0]).toContain('lower it to 450');
});

it('drops a baseline entry once the file fits or is gone', () => {
  const baseline = { 'src/a.ts': 500, 'src/gone.ts': 450 };
  const problems = findProblems({ 'src/a.ts': 400 }, baseline);
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain('It fits now: remove it');
  expect(problems[1]).toContain('src/gone.ts: not found. Remove it');
});
