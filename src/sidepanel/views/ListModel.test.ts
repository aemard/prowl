import { describe, expect, it } from 'vitest';
import { emptyPrLocal, snooze } from '../../lib/storage/prLocal';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings';
import { buildPullRequest } from '../../test/panel';
import { filterPullRequests, groupByRepo, sortPullRequests, splitSection } from './ListModel';

const prs = [
  buildPullRequest({
    number: 1,
    title: 'Fix login redirect',
    repo: { owner: 'acme', name: 'web', nameWithOwner: 'acme/web' },
    author: { login: 'alice', avatarUrl: '', isBot: false },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  }),
  buildPullRequest({
    number: 22,
    title: 'Add dark mode',
    repo: { owner: 'acme', name: 'api', nameWithOwner: 'acme/api' },
    author: { login: 'bob', avatarUrl: '', isBot: false },
    labels: [{ name: 'feature', color: '0e8a16' }],
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  }),
  buildPullRequest({
    number: 3,
    title: 'Bump deps',
    repo: { owner: 'acme', name: 'api', nameWithOwner: 'acme/api' },
    author: null,
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  }),
];
const numbers = (list: typeof prs) => list.map((pr) => pr.number);

describe('filterPullRequests', () => {
  it.each([
    ['', [1, 22, 3]],
    ['   ', [1, 22, 3]],
    ['LOGIN', [1]],
    ['acme/api', [22, 3]],
    ['bob', [22]],
    ['bug', [1]],
    ['#22', [22]],
    ['api dark', [22]],
    ['api nothing', []],
  ])('"%s" keeps %j', (query, expected) => {
    expect(numbers(filterPullRequests(prs, query))).toEqual(expected);
  });
});

describe('groupByRepo', () => {
  const inRepo = (number: number, nameWithOwner: string, updatedAt: string) => {
    const [owner = '', name = ''] = nameWithOwner.split('/');
    return buildPullRequest({ number, repo: { owner, name, nameWithOwner }, updatedAt });
  };
  // Newest first: web 1, mobile 2, web 3, api 4, mobile 5.
  const mixed = [
    inRepo(1, 'acme/web', '2026-10-06T05:00:00.000Z'),
    inRepo(2, 'acme/mobile', '2026-10-06T04:00:00.000Z'),
    inRepo(3, 'acme/web', '2026-10-06T03:00:00.000Z'),
    inRepo(4, 'acme/api', '2026-10-06T02:00:00.000Z'),
    inRepo(5, 'acme/mobile', '2026-10-06T01:00:00.000Z'),
  ];
  const shape = (list: ReturnType<typeof groupByRepo>) =>
    list.map(({ repo, prs: inside }) => [repo, inside.map((pr) => pr.number)]);

  it('orders the groups by their first PR, and keeps the order inside', () => {
    expect(shape(groupByRepo(sortPullRequests(mixed, 'updated')))).toEqual([
      ['acme/web', [1, 3]],
      ['acme/mobile', [2, 5]],
      ['acme/api', [4]],
    ]);
  });

  it('is alphabetical when the sort is by repository, newest first inside', () => {
    expect(shape(groupByRepo(sortPullRequests(mixed, 'repo')))).toEqual([
      ['acme/api', [4]],
      ['acme/mobile', [2, 5]],
      ['acme/web', [1, 3]],
    ]);
  });

  it('has no groups without PRs, and one group for one repository', () => {
    expect(groupByRepo([])).toEqual([]);
    expect(shape(groupByRepo(prs.slice(1)))).toEqual([['acme/api', [22, 3]]]);
  });
});

describe('sortPullRequests', () => {
  it.each([
    ['updated', [3, 1, 22]],
    ['created', [22, 3, 1]],
    ['repo', [3, 22, 1]],
  ] as const)('by %s', (order, expected) => {
    expect(numbers(sortPullRequests(prs, order))).toEqual(expected);
  });

  it('returns a copy', () => {
    const copy = [...prs];
    sortPullRequests(copy, 'created');
    expect(copy).toEqual(prs);
  });
});

describe('splitSection', () => {
  const NOW = Date.parse('2026-10-27T12:00:00.000Z');
  const recent = buildPullRequest({ number: 1, lastCommitAt: '2026-10-20T00:00:00.000Z' });
  const stale = buildPullRequest({ number: 2, lastCommitAt: '2026-09-20T00:00:00.000Z' });
  const staleSnoozed = buildPullRequest({ number: 3, lastCommitAt: '2026-09-01T00:00:00.000Z' });
  const snoozed = buildPullRequest({ number: 4, lastCommitAt: '2026-10-26T00:00:00.000Z' });
  const local = [staleSnoozed, snoozed].reduce(
    (state, pr) => snooze(state, pr.id, NOW + 3_600_000),
    emptyPrLocal(),
  );
  const all = [stale, recent, staleSnoozed, snoozed];

  it('shows recent PRs, hides stale ones with the reason, and keeps snoozed ones apart', () => {
    const parts = splitSection(all, local, DEFAULT_SETTINGS, NOW);
    expect(numbers(parts.shown)).toEqual([1]);
    expect(parts.hidden).toEqual([{ pr: stale, reasons: [{ kind: 'stale', days: 37 }] }]);
    expect(numbers(parts.snoozed)).toEqual([3, 4]);
  });

  it('hides nothing with 0, and lets ended snoozes back in, in the given order', () => {
    const parts = splitSection(
      all,
      local,
      { ...DEFAULT_SETTINGS, hideStaleAfterDays: 0 },
      NOW + 7_200_000,
    );
    expect(numbers(parts.shown)).toEqual([2, 1, 3, 4]);
    expect(parts.hidden).toEqual([]);
    expect(parts.snoozed).toEqual([]);
  });

  it('hides drafts and bots on request, with every reason, in the given order', () => {
    const draft = buildPullRequest({ number: 5, isDraft: true });
    const bot = buildPullRequest({
      number: 6,
      author: { login: 'dependabot', avatarUrl: '', isBot: true },
    });
    const both = buildPullRequest({
      number: 7,
      isDraft: true,
      author: { login: 'renovate', avatarUrl: '', isBot: true },
      lastCommitAt: '2026-09-20T00:00:00.000Z',
    });
    const prs = [draft, recent, bot, both];

    const none = splitSection(prs, emptyPrLocal(), DEFAULT_SETTINGS, NOW);
    expect(numbers(none.shown)).toEqual([5, 1, 6]);
    expect(none.hidden.map(({ reasons }) => reasons)).toEqual([[{ kind: 'stale', days: 37 }]]);

    const drafts = splitSection(
      prs,
      emptyPrLocal(),
      { ...DEFAULT_SETTINGS, hideDrafts: true },
      NOW,
    );
    expect(numbers(drafts.shown)).toEqual([1, 6]);
    expect(drafts.hidden.map(({ pr }) => pr.number)).toEqual([5, 7]);

    const all = splitSection(
      prs,
      emptyPrLocal(),
      { hideDrafts: true, hideBots: true, hideStaleAfterDays: 20 },
      NOW,
    );
    expect(numbers(all.shown)).toEqual([1]);
    expect(all.hidden).toEqual([
      { pr: draft, reasons: [{ kind: 'draft' }] },
      { pr: bot, reasons: [{ kind: 'bot' }] },
      { pr: both, reasons: [{ kind: 'draft' }, { kind: 'bot' }, { kind: 'stale', days: 37 }] },
    ]);
  });

  it('keeps a snoozed draft under Snoozed', () => {
    const draft = buildPullRequest({ number: 5, isDraft: true });
    const local = snooze(emptyPrLocal(), draft.id, NOW + 3_600_000);
    const parts = splitSection([draft], local, { ...DEFAULT_SETTINGS, hideDrafts: true }, NOW);
    expect(numbers(parts.snoozed)).toEqual([5]);
    expect(parts.hidden).toEqual([]);
  });
});
