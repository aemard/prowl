/**
 * A realistic set of pull requests for the list E2E: several repositories, a draft, conflicts,
 * failing / pending / passing / no CI, approvals, requested changes, label colors from near
 * white to near black, titles and names that are too long for the panel, and one authored PR
 * with no commit for 34 days, which the default settings hide. Dates are relative to now.
 */
import { headCommit, prNode as node, reviewNode } from '../../fixtures/github';
import { MOCK_ORIGIN } from '../mock-github/server';

type NodeOverrides = Parameters<typeof node>[0];

/** `prNode` whose URL is on the mock GitHub site: the panel opens only URLs on the web origin. */
function prNode(overrides: NodeOverrides) {
  const pr = node(overrides);
  return { ...pr, url: `${MOCK_ORIGIN}/${pr.repository.nameWithOwner}/pull/${pr.number}` };
}

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

/** A round avatar with the login's initial, as a data URL (the E2E has no network). */
function avatar(login: string, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/><text x="32" y="43" font-family="sans-serif" font-size="32" font-weight="600" text-anchor="middle" fill="#fff">${login[0]?.toUpperCase()}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const PEOPLE = {
  octocat: avatar('octocat', '#8250df'),
  alice: avatar('alice', '#bf3989'),
  bob: avatar('bob', '#0969da'),
  carol: avatar('carol', '#1a7f37'),
  erin: avatar('erin', '#bc4c00'),
  frank: avatar('frank', '#57606a'),
};
export const by = (login: keyof typeof PEOPLE) => ({ login, avatarUrl: PEOPLE[login] });
const labels = (...pairs: [string, string][]) => ({
  nodes: pairs.map(([name, color]) => ({ name, color })),
});
const threads = (open: number, resolved = 0) => ({
  nodes: [
    ...Array.from({ length: open }, () => ({ isResolved: false })),
    ...Array.from({ length: resolved }, () => ({ isResolved: true })),
  ],
});

/** Created by octocat. */
export const authored = [
  prNode({
    repository: 'acme/web',
    number: 2481,
    title:
      'Refactor checkout flow to use the new payment session API and remove the legacy cart reducers',
    author: by('octocat'),
    createdAt: ago(9 * 24),
    updatedAt: ago(0.2),
    commits: headCommit({ FAILURE: 2, SUCCESS: 11, SKIPPED: 1 }, {}, ago(0.5)),
    reviewDecision: 'CHANGES_REQUESTED',
    latestReviews: { nodes: [reviewNode('alice', 'CHANGES_REQUESTED')] },
    labels: labels(
      ['bug', 'd73a4a'],
      ['needs-design', 'fbca04'],
      ['area/checkout', '0075ca'],
      ['regression', 'b60205'],
    ),
    reviewThreads: threads(4, 2),
    totalCommentsCount: 12,
  }),
  prNode({
    repository: 'acme/api',
    number: 912,
    title: 'Add rate limiting middleware',
    author: by('octocat'),
    createdAt: ago(3 * 24),
    updatedAt: ago(1),
    commits: headCommit({ SUCCESS: 8 }, {}, ago(20)),
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
    labels: labels(['feature', '0e8a16'], ['backend', '1d76db']),
    totalCommentsCount: 3,
  }),
  prNode({
    repository: 'acme/api',
    number: 905,
    title: 'WIP: migrate to Postgres 16',
    author: by('octocat'),
    isDraft: true,
    createdAt: ago(2 * 24),
    updatedAt: ago(3),
    commits: headCommit({ PENDING: 3, SUCCESS: 4 }, {}, ago(3)),
    reviewDecision: null,
    mergeStateStatus: 'DRAFT',
    labels: labels(['infra', '5319e7']),
  }),
  prNode({
    repository: 'acme/mobile',
    number: 377,
    title: 'Fix crash when rotating the device on the settings screen',
    author: by('octocat'),
    createdAt: ago(6 * 24),
    updatedAt: ago(26),
    commits: headCommit({ SUCCESS: 5 }, {}, ago(4 * 24)),
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
    labels: labels(['platform:ios', 'c5def5'], ['crash', 'e99695']),
    reviewThreads: threads(1),
    totalCommentsCount: 2,
  }),
  prNode({
    repository: 'octo/docs',
    number: 58,
    title: 'Update README badges',
    author: by('octocat'),
    createdAt: ago(3 * 24),
    updatedAt: ago(2 * 24),
    commits: headCommit(null, {}, ago(3 * 24)),
    reviewDecision: null,
    mergeStateStatus: 'CLEAN',
  }),
  prNode({
    repository: 'northwind-engineering/internal-platform-services-monorepo',
    number: 1042,
    title:
      'chore(deps): bump the production-dependencies group across 3 directories with 14 updates',
    author: by('octocat'),
    createdAt: ago(4 * 24),
    updatedAt: ago(4 * 24),
    commits: headCommit({ PENDING: 6 }, {}, ago(4 * 24)),
    labels: labels(
      ['dependencies', '0366d6'],
      ['a-very-long-label-name-that-should-truncate-nicely', 'ffffff'],
      ['wontfix', '000000'],
    ),
  }),
  prNode({
    repository: 'acme/web',
    number: 2470,
    title: 'Dark mode: fix contrast of disabled buttons',
    author: by('octocat'),
    createdAt: ago(8 * 24),
    updatedAt: ago(6 * 24),
    commits: headCommit({ PENDING: 1, SUCCESS: 11 }, {}, ago(7 * 24)),
    reviewDecision: 'APPROVED',
    labels: labels(['design', '0b1f3a'], ['a11y', '1d76db']),
    totalCommentsCount: 7,
  }),
  prNode({
    repository: 'acme/web',
    number: 2311,
    title: 'Experiment: lazy-load the analytics bundle',
    author: by('octocat'),
    createdAt: ago(52 * 24),
    updatedAt: ago(9 * 24),
    commits: headCommit({ SUCCESS: 11 }, {}, ago(34 * 24 + 5)),
    labels: labels(['performance', 'f9d0c4']),
    totalCommentsCount: 4,
  }),
];

export const reviewRequested = [
  prNode({
    repository: 'acme/web',
    number: 2490,
    title: 'Add keyboard shortcuts to the command palette',
    author: by('alice'),
    createdAt: ago(24),
    updatedAt: ago(0.3),
    commits: headCommit({ SUCCESS: 9 }, {}, ago(0.4)),
    labels: labels(['feature', '0e8a16']),
  }),
  prNode({
    repository: 'acme/api',
    number: 918,
    title: 'Return 409 instead of 500 when a slug already exists',
    author: by('bob'),
    createdAt: ago(2 * 24),
    updatedAt: ago(5),
    commits: headCommit({ FAILURE: 1, SUCCESS: 7 }, {}, ago(6)),
    labels: labels(['bug', 'd73a4a']),
    reviewThreads: threads(1),
    totalCommentsCount: 5,
  }),
  prNode({
    repository: 'octo/docs',
    number: 61,
    title: 'Document the new webhook retry policy',
    author: by('carol'),
    createdAt: ago(3 * 24),
    updatedAt: ago(2 * 24),
    commits: headCommit(null, {}, ago(3 * 24)),
  }),
];

export const mentioned = [
  prNode({
    repository: 'acme/web',
    number: 2475,
    title: 'Spike: edge-render the product page',
    author: by('erin'),
    createdAt: ago(5 * 24),
    updatedAt: ago(3 * 24),
    commits: headCommit({ PENDING: 2 }, {}, ago(5 * 24)),
    totalCommentsCount: 9,
  }),
];

export const assigned = [
  prNode({
    repository: 'acme/web',
    number: 2462,
    title: 'Replace moment with date-fns',
    author: by('frank'),
    createdAt: ago(9 * 24),
    updatedAt: ago(5 * 24),
    commits: headCommit({ SUCCESS: 10 }, {}, ago(8 * 24)),
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
    labels: labels(['dependencies', '0366d6']),
  }),
];

/** The nodes a `ProwlSearch` query for `query` returns, by the section qualifier. */
export function nodesFor(query: unknown) {
  const text = String(query);
  if (text.includes('author:@me')) return authored;
  if (text.includes('review-requested:@me')) return reviewRequested;
  if (text.includes('mentions:@me')) return mentioned;
  if (text.includes('assignee:@me')) return assigned;
  return [];
}
