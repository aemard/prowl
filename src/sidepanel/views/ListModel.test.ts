import { describe, expect, it } from 'vitest';
import { buildPullRequest } from '../../test/panel';
import { filterPullRequests, sortPullRequests } from './ListModel';

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
