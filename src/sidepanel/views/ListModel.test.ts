import { describe, expect, it } from 'vitest';
import { emptyPrLocal, snooze } from '../../lib/storage/prLocal';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings';
import { buildPullRequest } from '../../test/panel';
import { filterPullRequests, sortPullRequests, splitSection } from './ListModel';

const prs = [
  buildPullRequest({
    number: 1,
    title: 'Fix login redirect',
    repo: { owner: 'acme', name: 'web', nameWithOwner: 'acme/web' },
    author: { login: 'alice', avatarUrl: '' },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  }),
  buildPullRequest({
    number: 22,
    title: 'Add dark mode',
    repo: { owner: 'acme', name: 'api', nameWithOwner: 'acme/api' },
    author: { login: 'bob', avatarUrl: '' },
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
    const parts = splitSection(all, local, { hideStaleAfterDays: 0 }, NOW + 7_200_000);
    expect(numbers(parts.shown)).toEqual([2, 1, 3, 4]);
    expect(parts.hidden).toEqual([]);
    expect(parts.snoozed).toEqual([]);
  });
});
