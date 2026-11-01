import { describe, expect, it } from 'vitest';
import type { Section } from '../model';
import { normalizeRepoPattern, normalizeTime } from './settings';
import { presets, sectionsOf } from './settings.test-support';

it('normalizeSettings sections uses the default sections when sections is not a list', () => {
  expect(sectionsOf(undefined)).toEqual(presets());
  expect(sectionsOf({ authored: true })).toEqual(presets());
});

it('normalizeSettings sections keeps the stored order and appends missing presets with their defaults', () => {
  expect(
    sectionsOf([
      { id: 'mentioned', kind: 'mentioned', label: 'Mentioned', enabled: true },
      {
        id: 'c1',
        kind: 'custom',
        label: 'Team',
        enabled: true,
        query: 'team-review-requested:org/team',
      },
    ]),
  ).toEqual([
    { id: 'mentioned', kind: 'mentioned', label: 'Mentioned', enabled: true },
    {
      id: 'c1',
      kind: 'custom',
      label: 'Team',
      enabled: true,
      query: 'team-review-requested:org/team',
    },
    ...presets().filter((section) => section.kind !== 'mentioned'),
  ]);
  expect(sectionsOf([])).toEqual(presets());
});

it('normalizeSettings sections gives presets their canonical id and label, drops duplicates and stray queries', () => {
  expect(
    sectionsOf([
      { id: 'mine', kind: 'authored', label: 'Mine', enabled: false, query: 'is:draft', x: 1 },
      { id: 'authored', kind: 'authored', enabled: true },
      { kind: 'assigned', enabled: 'no' },
    ]),
  ).toEqual([
    { id: 'authored', kind: 'authored', label: 'Created by me', enabled: false },
    { id: 'assigned', kind: 'assigned', label: 'Assigned to me', enabled: false },
    ...presets().slice(1, 4),
  ]);
});

it('normalizeSettings sections enables a missing Team reviews section when Review requested is followed', () => {
  // Settings stored before team reviews had their own section.
  const before = presets({ review_requested: true }).filter(
    (section) => section.kind !== 'team_review_requested',
  );
  expect(sectionsOf(before)).toEqual([...before, { ...presets()[2], enabled: true } as Section]);
  expect(sectionsOf(presets().filter((s) => s.kind !== 'team_review_requested'))).toContainEqual(
    presets()[2],
  );
  // Once stored, the section keeps its own state.
  expect(sectionsOf(presets({ review_requested: true }))).toEqual(
    presets({ review_requested: true }),
  );
});

it('normalizeSettings sections drops entries that are not sections', () => {
  expect(sectionsOf([null, 'authored', 7, [], { kind: 'issues' }, { id: 'x' }])).toEqual(presets());
});

it('normalizeSettings sections requires a query for custom sections and trims query and label', () => {
  const sections = sectionsOf([
    { id: 'empty', kind: 'custom', label: 'Empty', query: '   ' },
    { id: 'missing', kind: 'custom', label: 'Missing' },
    { id: 'number', kind: 'custom', label: 'Number', query: 42 },
    { id: 'ok', kind: 'custom', label: '  Bots  ', query: '  author:app/renovate  ' },
  ]);
  expect(sections.filter((section) => section.kind === 'custom')).toEqual([
    { id: 'ok', kind: 'custom', label: 'Bots', enabled: true, query: 'author:app/renovate' },
  ]);
});

it('normalizeSettings sections falls back to the query as label and caps labels at 60 characters', () => {
  const [blank, long] = sectionsOf([
    { id: 'a', kind: 'custom', label: '  ', enabled: false, query: 'label:urgent' },
    { id: 'b', kind: 'custom', label: 'x'.repeat(80), query: 'q' },
  ]);
  expect(blank).toEqual({
    id: 'a',
    kind: 'custom',
    label: 'label:urgent',
    enabled: false,
    query: 'label:urgent',
  });
  expect(long?.label).toBe('x'.repeat(60));
});

it('normalizeSettings sections assigns custom-N ids to custom sections whose id is missing, invalid, a preset or taken', () => {
  const ids = sectionsOf([
    { kind: 'custom', query: 'a' },
    { id: 'has space', kind: 'custom', query: 'b' },
    { id: 'authored', kind: 'custom', query: 'c' },
    { id: 'custom-1', kind: 'custom', query: 'd' },
    { id: 'dup', kind: 'custom', query: 'e' },
    { id: 'dup', kind: 'custom', query: 'f' },
    { id: 'x'.repeat(65), kind: 'custom', query: 'g' },
    { id: 'authored', kind: 'authored' },
  ]).map((section) => section.id);
  expect(ids).toEqual([
    'custom-2',
    'custom-3',
    'custom-4',
    'custom-1',
    'dup',
    'custom-5',
    'custom-6',
    'authored',
    'review_requested',
    'team_review_requested',
    'mentioned',
    'assigned',
  ]);
  expect(new Set(ids).size).toBe(ids.length);
});

describe('normalizeTime', () => {
  it.each([
    ['00:00', '00:00'],
    ['7:05', '07:05'],
    [' 23:59 ', '23:59'],
    ['24:00', null],
    ['12:60', null],
    ['12:5', null],
    ['1200', null],
    ['', null],
    [930, null],
  ])('normalizes %j to %j', (value, expected) => {
    expect(normalizeTime(value)).toBe(expected);
  });
});

describe('normalizeRepoPattern', () => {
  it('accepts owners and owner/name and rejects everything else', () => {
    expect(normalizeRepoPattern('  octo  ')).toBe('octo');
    expect(normalizeRepoPattern('octo/.github')).toBe('octo/.github');
    expect(normalizeRepoPattern(`${'a'.repeat(39)}/${'b'.repeat(100)}`)).not.toBeNull();
    for (const invalid of ['octo/.', `${'a'.repeat(40)}`, `a/${'b'.repeat(101)}`, 'a b', 'é']) {
      expect(normalizeRepoPattern(invalid)).toBeNull();
    }
    expect(normalizeRepoPattern(undefined)).toBeNull();
  });
});
