import { describe, expect, it } from 'vitest';
import type { Section } from '../model';
import { buildSearchQuery, filterByRepo, validateCustomQuery } from './search';

const none = { repoInclude: [], repoExclude: [] };
const preset = (kind: Exclude<Section['kind'], 'custom'>): Section => ({
  id: kind,
  kind,
  label: kind,
  enabled: true,
});
const custom = (query?: string): Section => ({
  id: 'custom-1',
  kind: 'custom',
  label: 'Mine',
  enabled: true,
  ...(query === undefined ? {} : { query }),
});

describe('buildSearchQuery', () => {
  it.each([
    ['authored', 'is:pr is:open author:@me archived:false'],
    ['review_requested', 'is:pr is:open review-requested:@me archived:false'],
    ['mentioned', 'is:pr is:open mentions:@me archived:false'],
    ['assigned', 'is:pr is:open assignee:@me archived:false'],
  ] as const)('builds the %s preset', (kind, expected) => {
    expect(buildSearchQuery(preset(kind), none)).toBe(expected);
  });

  it('adds repo: for owner/name and user: for a bare owner', () => {
    const settings = { repoInclude: ['acme/api', 'octo'], repoExclude: [] };
    expect(buildSearchQuery(preset('authored'), settings)).toBe(
      'is:pr is:open author:@me archived:false repo:acme/api user:octo',
    );
  });

  it('adds -repo: and -user: for exclusions', () => {
    const settings = { repoInclude: [], repoExclude: ['acme/legacy', 'spam'] };
    expect(buildSearchQuery(preset('mentioned'), settings)).toBe(
      'is:pr is:open mentions:@me archived:false -repo:acme/legacy -user:spam',
    );
  });

  it('combines include and exclude, include first', () => {
    const settings = { repoInclude: ['acme'], repoExclude: ['acme/legacy'] };
    expect(buildSearchQuery(preset('assigned'), settings)).toBe(
      'is:pr is:open assignee:@me archived:false user:acme -repo:acme/legacy',
    );
  });

  it('enforces is:pr on custom queries and keeps the rest as typed', () => {
    expect(buildSearchQuery(custom('  author:@me label:bug  '), none)).toBe(
      'is:pr author:@me label:bug',
    );
    expect(buildSearchQuery(custom('is:pr review:approved'), none)).toBe(
      'is:pr is:pr review:approved',
    );
    expect(buildSearchQuery(custom('fix OR hotfix'), none)).toBe('is:pr fix OR hotfix');
  });

  it('applies repo filters to custom queries', () => {
    const settings = { repoInclude: ['acme/api'], repoExclude: ['acme/legacy'] };
    expect(buildSearchQuery(custom('label:bug'), settings)).toBe(
      'is:pr label:bug repo:acme/api -repo:acme/legacy',
    );
  });

  it.each(['repo:acme/web label:bug', 'label:bug org:acme', 'user:octo', '(REPO:acme/web)'])(
    'lets the scope of the custom query %j win over the include list',
    (query) => {
      const settings = { repoInclude: ['other'], repoExclude: ['acme/legacy'] };
      expect(buildSearchQuery(custom(query), settings)).toBe(`is:pr ${query} -repo:acme/legacy`);
    },
  );

  it('does not take a negated scope or a lookalike for the query own scope', () => {
    const settings = { repoInclude: ['other'], repoExclude: [] };
    expect(buildSearchQuery(custom('-repo:acme/web'), settings)).toBe(
      'is:pr -repo:acme/web user:other',
    );
    expect(buildSearchQuery(custom('label:myrepo:x'), settings)).toBe(
      'is:pr label:myrepo:x user:other',
    );
  });

  it('returns only is:pr plus filters for a custom section without a query', () => {
    expect(buildSearchQuery(custom(), none)).toBe('is:pr');
    expect(buildSearchQuery(custom('   '), { repoInclude: ['acme'], repoExclude: [] })).toBe(
      'is:pr user:acme',
    );
  });
});

describe('filterByRepo', () => {
  const pr = (nameWithOwner: string) => {
    const [owner = '', name = ''] = nameWithOwner.split('/');
    return { id: nameWithOwner, repo: { owner, name, nameWithOwner } };
  };
  const prs = [pr('acme/api'), pr('acme/legacy'), pr('Octo/Tools'), pr('other/thing')];
  const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

  it('keeps everything without filters', () => {
    expect(filterByRepo(prs, none)).toEqual(prs);
  });

  it('keeps only included repos and owners, ignoring case', () => {
    expect(ids(filterByRepo(prs, { repoInclude: ['acme/API', 'octo'], repoExclude: [] }))).toEqual([
      'acme/api',
      'Octo/Tools',
    ]);
  });

  it('drops excluded repos and owners, ignoring case', () => {
    expect(
      ids(filterByRepo(prs, { repoInclude: [], repoExclude: ['ACME/legacy', 'OTHER'] })),
    ).toEqual(['acme/api', 'Octo/Tools']);
  });

  it('applies exclude after include', () => {
    const filters = { repoInclude: ['acme'], repoExclude: ['acme/legacy'] };
    expect(ids(filterByRepo(prs, filters))).toEqual(['acme/api']);
  });

  it('drops everything when a repo is both included and excluded', () => {
    expect(filterByRepo(prs, { repoInclude: ['acme/api'], repoExclude: ['acme/api'] })).toEqual([]);
  });

  it('does not mistake an owner pattern for part of another owner or repo name', () => {
    const filters = { repoInclude: ['acme'], repoExclude: [] };
    expect(filterByRepo([pr('acme-corp/api'), pr('x/acme')], filters)).toEqual([]);
  });
});

describe('validateCustomQuery', () => {
  it.each(['', '   ', '\n'])('rejects an empty query %j', (query) => {
    expect(validateCustomQuery(query)).toEqual([expect.stringContaining('Enter a GitHub search')]);
  });

  it.each([
    'is:issue',
    'author:@me type:issue',
    'IS:ISSUE bug',
    '(is:issue OR bug)',
    '-is:pr label:bug',
    '-type:pull-request',
  ])('rejects %j: not a pull request query', (query) => {
    expect(validateCustomQuery(query)).toEqual([expect.stringContaining('pull requests only')]);
  });

  it.each([
    'is:pr',
    'is:pr author:@me',
    'type:pr label:bug',
    'is:issuer',
    'label:is:issue',
    'review:approved -is:draft',
  ])('accepts %j', (query) => {
    expect(validateCustomQuery(query)).toEqual([]);
  });

  it('allows operators between search words, up to five', () => {
    expect(validateCustomQuery('fix OR hotfix OR patch OR (a AND b NOT c)')).toEqual([]);
    const six = 'a OR b OR c OR d OR e OR f OR g';
    expect(validateCustomQuery(six)).toEqual([expect.stringContaining('at most 5')]);
    expect(validateCustomQuery(six)[0]).toContain('found 6');
  });

  it('does not count lowercase or and, nor operators inside a quoted phrase', () => {
    expect(validateCustomQuery('fix or hotfix and more "this OR that"')).toEqual([]);
  });

  it('rejects operators between qualifiers only', () => {
    expect(validateCustomQuery('author:a OR author:b')).toEqual([
      expect.stringContaining('only work between search words'),
    ]);
    expect(validateCustomQuery('NOT label:bug')).toHaveLength(1);
    expect(validateCustomQuery('label:bug OR label:"good first issue" fix')).toEqual([]);
  });

  it('limits the search words to 256 characters but not the qualifiers', () => {
    const words = (length: number) => 'x'.repeat(length);
    expect(validateCustomQuery(words(256))).toEqual([]);
    const tooLong = validateCustomQuery(words(257));
    expect(tooLong).toEqual([expect.stringContaining('256 characters')]);
    expect(tooLong[0]).toContain('found 257');
    const qualifiers = Array.from({ length: 40 }, (_, i) => `label:name-${i}`).join(' ');
    expect(qualifiers.length).toBeGreaterThan(256);
    expect(validateCustomQuery(qualifiers)).toEqual([]);
    expect(validateCustomQuery(`${words(256)} ${qualifiers}`)).toEqual([]);
  });

  it('reports every problem at once', () => {
    const query = `is:issue ${'a OR '.repeat(6)}${'x'.repeat(260)}`;
    expect(validateCustomQuery(query)).toHaveLength(3);
  });
});
