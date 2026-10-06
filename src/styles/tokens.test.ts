import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const css = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

type Tokens = Map<string, string>;

/** Returns the declarations of every rule whose selector is exactly `selector`, in order. */
function blocks(selector: string): Tokens[] {
  const out: Tokens[] = [];
  const pattern = new RegExp(`${selector.replace(/[[\]().:"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  for (const match of css.matchAll(pattern)) {
    const tokens: Tokens = new Map();
    for (const decl of (match[1] ?? '').split(';')) {
      const [name, ...value] = decl.split(':');
      if (name?.trim().startsWith('--')) tokens.set(name.trim(), value.join(':').trim());
    }
    out.push(tokens);
  }
  return out;
}

const rootBlocks = blocks(':root');
const empty: Tokens = new Map();
const shared = rootBlocks.find((b) => b.has('--space-1')) ?? empty;
const lightOwn = rootBlocks.find((b) => b.has('--color-bg')) ?? empty;
const reducedMotion = rootBlocks.find((b) => !b.has('--space-1') && b.has('--duration-fast'));
const light = new Map([...shared, ...lightOwn]);
const darkSystem = blocks(':root:not([data-theme="light"])')[0] ?? empty;
const darkForced = blocks(':root[data-theme="dark"]')[0] ?? empty;
const dark = new Map([...light, ...darkSystem]);

function resolveColor(tokens: Tokens, name: string): string {
  let value = tokens.get(name);
  for (let depth = 0; value?.startsWith('var(') && depth < 5; depth++) {
    value = tokens.get(value.slice(4, -1).trim());
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a hex color`);
  return value;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const ratio = (tokens: Tokens, fg: string, bg: string) =>
  contrast(resolveColor(tokens, `--color-${fg}`), resolveColor(tokens, `--color-${bg}`));

const HUES = ['accent', 'success', 'danger', 'warning', 'attention', 'done'] as const;
const SURFACES = ['bg', 'bg-subtle', 'bg-hover', 'bg-active', 'surface'] as const;
const TEXT_ROWS = ['fg', 'fg-muted', 'neutral-fg', ...HUES.map((h) => `${h}-fg`)];
/** Tinted background each text row is also checked on (chips, selected items). */
const tintOf = (row: string) =>
  row === 'fg' || row === 'fg-muted' ? 'accent-bg' : row.replace(/-fg$/, '-bg');
const SOLIDS = [
  'accent-solid',
  'accent-solid-hover',
  'success-solid',
  'danger-solid',
  'danger-solid-hover',
  'warning-solid',
  'attention-solid',
  'done-solid',
  'neutral-solid',
];
/** Non-text UI pairs (WCAG 1.4.11, 3:1): control borders, focus ring, switch track and thumb. */
const UI_PAIRS: [fg: string, bg: string][] = [
  ['border-control', 'bg'],
  ['border-control', 'bg-subtle'],
  ['border-control', 'surface'],
  ['focus', 'bg'],
  ['focus', 'bg-subtle'],
  ['focus', 'surface'],
  ['accent-solid', 'bg'],
  ['fg-on-solid', 'border-control'],
  ['brand-eye', 'brand'],
  ['brand-pupil', 'brand-eye'],
];

const fmt = (n: number) => n.toFixed(2);
const cell = (fg: string, bg: string) =>
  `${fmt(ratio(light, fg, bg))} / ${fmt(ratio(dark, fg, bg))}`;

function contrastTable(): string {
  const lines = [
    'Text, 4.5:1 minimum. Each cell is `light / dark`.',
    '',
    `| Text token | ${[...SURFACES, 'tint'].map((s) => `\`${s}\``).join(' | ')} |`,
    `|---|${[...SURFACES, 'tint'].map(() => '---:').join('|')}|`,
    ...TEXT_ROWS.map(
      (row) =>
        `| \`${row}\` | ${SURFACES.map((s) => cell(row, s)).join(' | ')} | ${cell(row, tintOf(row))} (\`${tintOf(row)}\`) |`,
    ),
    '',
    'Text on solid fills (`fg-on-solid`), 4.5:1 minimum.',
    '',
    '| Background | Light | Dark |',
    '|---|---:|---:|',
    ...SOLIDS.map(
      (s) =>
        `| \`${s}\` | ${fmt(ratio(light, 'fg-on-solid', s))} | ${fmt(ratio(dark, 'fg-on-solid', s))} |`,
    ),
    '',
    'UI components and graphics, 3:1 minimum.',
    '',
    '| Foreground | Background | Light | Dark |',
    '|---|---|---:|---:|',
    ...UI_PAIRS.map(
      ([fg, bg]) =>
        `| \`${fg}\` | \`${bg}\` | ${fmt(ratio(light, fg, bg))} | ${fmt(ratio(dark, fg, bg))} |`,
    ),
  ];
  return lines.join('\n');
}

describe('design tokens', () => {
  it('parses the shared, light and both dark blocks', () => {
    expect(shared.get('--space-1')).toBe('4px');
    expect(light.get('--color-bg')).toBe('var(--gray-1)');
    expect(darkSystem.size).toBeGreaterThan(50);
  });

  it('keeps the system-dark and forced-dark blocks identical', () => {
    expect([...darkForced]).toEqual([...darkSystem]);
  });

  it('redefines every themed token in dark', () => {
    expect([...lightOwn.keys()].filter((k) => !darkSystem.has(k))).toEqual([]);
  });

  it('collapses transition durations under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{/);
    expect(reducedMotion?.get('--duration-fast')).toBe('0ms');
    expect(reducedMotion?.get('--duration-normal')).toBe('0ms');
  });

  for (const [theme, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`meets WCAG AA for text in ${theme}`, () => {
      const failures: string[] = [];
      for (const row of TEXT_ROWS) {
        for (const bg of [...SURFACES, tintOf(row)]) {
          const r = ratio(tokens, row, bg);
          if (r < 4.5) failures.push(`${row} on ${bg}: ${fmt(r)}`);
        }
      }
      for (const solid of SOLIDS) {
        const r = ratio(tokens, 'fg-on-solid', solid);
        if (r < 4.5) failures.push(`fg-on-solid on ${solid}: ${fmt(r)}`);
      }
      expect(failures).toEqual([]);
    });

    it(`meets 3:1 for UI components and graphics in ${theme}`, () => {
      const failures = UI_PAIRS.filter(([fg, bg]) => ratio(tokens, fg, bg) < 3).map(
        ([fg, bg]) => `${fg} on ${bg}: ${fmt(ratio(tokens, fg, bg))}`,
      );
      expect(failures).toEqual([]);
    });
  }

  it('documents the current contrast table in docs/design.md', () => {
    const doc = readFileSync(resolve(root, 'docs/design.md'), 'utf8');
    const current = /<!-- contrast:start -->\n([\s\S]*?)\n<!-- contrast:end -->/.exec(doc)?.[1];
    // On failure, paste the expected table between the markers in docs/design.md.
    expect(current).toBe(contrastTable());
  });

  it('keeps raw colors out of every stylesheet except tokens.css', () => {
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    for (const file of walk(resolve(root, 'src'))) {
      if (!file.endsWith('.css') || file.endsWith('tokens.css')) continue;
      const source = readFileSync(file, 'utf8');
      if (/:[^;{}]*(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('computes contrast like WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(() => resolveColor(light, '--color-backdrop')).toThrow(/not a hex color/);
  });
});
