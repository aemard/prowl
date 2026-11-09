import { describe, expect, it } from 'vitest';
import { prNode, requestedTeam, searchResponse } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import { diffSnapshots } from '../diff/diffSnapshots';
import { snapshot } from '../diff/diffSnapshots.test-support';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, section, settings, setup } from './fetchPullRequests.test-support';
import { SEARCH_QUERY, TEAM_SEARCH_QUERY } from './queries';

const teamSection = section('team_review_requested');
const discovered = (...keys: string[]) => ({
  teams: keys.map((key) => {
    const [org = '', slug = ''] = key.split('/');
    return { org, slug, name: slug };
  }),
  error: null,
});
const requested = (number: number, ...keys: string[]) =>
  prNode({
    number,
    reviewRequests: {
      totalCount: keys.length,
      pageInfo: { hasNextPage: false },
      nodes: keys.map(requestedTeam),
    },
  });
const opts = (extra = {}) => settings({ sections: [teamSection], ...extra });

describe('team search', () => {
  it('isolates Team fields from shared searches', () => {
    expect(SEARCH_QUERY).not.toContain('... on Team');
    expect(TEAM_SEARCH_QUERY).toContain('... on Team { slug organization { login } }');
  });

  it('uses one query for more than ten teams, with repository filters', async () => {
    const keys = Array.from({ length: 15 }, (_, i) => `acme/t${i}`);
    const pr = requested(1, keys[14] ?? '');
    const { client, queries } = setup({ ProwlSearch: bySearch({ '@me': [pr] }) });
    const result = await fetchPullRequests(
      client,
      opts({ repoExclude: ['acme/old'] }),
      null,
      discovered(...keys),
    );
    expect(queries().map(({ query }) => query)).toEqual([
      'is:pr is:open team-review-requested-user:@me archived:false -repo:acme/old sort:updated-desc',
    ]);
    expect(result.sections.team_review_requested).toEqual([pr.id]);
    expect(result.teamRequests[pr.id]).toEqual(['acme/t14']);
  });

  it('filters off teams before the cap and keeps mixed and other-section memberships', async () => {
    const off = requested(1, 'ACME/Off');
    const mixed = requested(2, 'acme/off', 'acme/on', 'other/foreign');
    const on = requested(3, 'acme/on');
    const { client, queries } = setup({
      ProwlSearch: bySearch({
        'author:@me': [off],
        'team-review-requested-user': [off, mixed, on],
      }),
    });
    const result = await fetchPullRequests(
      client,
      opts({
        sections: [section('authored'), teamSection],
        maxPerSection: 2,
        unfollowedTeams: ['acme/off'],
      }),
      null,
      discovered('acme/off', 'acme/on'),
    );
    expect(result.sections.authored).toEqual([off.id]);
    expect(result.sections.team_review_requested).toEqual([mixed.id, on.id]);
    expect(result.pullRequests[off.id]).toBeDefined();
    expect(result.teamRequests[mixed.id]).toEqual(['acme/off', 'acme/on']);
    expect(queries()).toHaveLength(3);
  });

  it.each([
    'truncated',
    'null team',
    'unreadable team',
    'unknown membership',
    'incomplete membership',
  ])('keeps results with %s evidence', async (kind) => {
    const pr = requested(1, 'acme/off');
    if (kind === 'truncated')
      pr.reviewRequests = {
        nodes: pr.reviewRequests?.nodes ?? [],
        totalCount: 2,
        pageInfo: { hasNextPage: true },
      };
    if (kind === 'null team')
      pr.reviewRequests = {
        nodes: [{ requestedReviewer: null }],
        totalCount: 1,
        pageInfo: { hasNextPage: false },
      };
    if (kind === 'unreadable team')
      pr.reviewRequests = {
        nodes: [{ requestedReviewer: {} }],
        totalCount: 1,
        pageInfo: { hasNextPage: false },
      };
    const membership =
      kind === 'unknown membership'
        ? null
        : { ...discovered('acme/off'), incomplete: kind === 'incomplete membership' };
    const { client } = setup({ ProwlSearch: bySearch({ '@me': [pr] }) });
    const result = await fetchPullRequests(
      client,
      opts({ unfollowedTeams: ['acme/off'] }),
      null,
      membership,
    );
    expect(result.sections.team_review_requested).toEqual([pr.id]);
    if (kind !== 'truncated') expect(result.teamRequests).toEqual({});
  });

  it('retries without Team fields on a permission refusal and keeps results without chips', async () => {
    const pr = requested(1, 'acme/off');
    let attempts = 0;
    const { client } = setup({
      ProwlSearch: (v) =>
        ++attempts === 1
          ? jsonResponse({ message: 'Resource not accessible' }, { status: 403 })
          : searchResponse([pr], v),
    });
    const result = await fetchPullRequests(
      client,
      opts({ unfollowedTeams: ['acme/off'] }),
      null,
      discovered('acme/off'),
    );
    expect(attempts).toBe(2);
    expect(result.sections.team_review_requested).toEqual([pr.id]);
    expect(result.teamRequests).toEqual({});
  });

  it('does not restore an explicitly excluded PR during a cut scan', async () => {
    const off = requested(1, 'acme/off');
    const { client } = setup({
      ProwlSearch: (v) => {
        const response = searchResponse([off], { ...v, first: 1 });
        response.search.pageInfo = { hasNextPage: true, endCursor: null };
        return response;
      },
      ProwlNodes: () => ({ nodes: [null], rateLimit: null }),
    });
    const result = await fetchPullRequests(
      client,
      opts({ unfollowedTeams: ['acme/off'] }),
      {
        pullRequests: { [off.id]: mapped(off) },
        sections: { team_review_requested: [off.id] },
      },
      discovered('acme/off'),
    );
    expect(result.sections.team_review_requested).toEqual([]);
    expect(result.sectionCoverage?.team_review_requested?.stale).toBe(true);
  });

  it('drops switched-off open PRs without a gone lookup or closure events', async () => {
    const off = requested(1, 'acme/off');
    const before = snapshot([mapped(off)]);
    before.sections = { team_review_requested: [off.id] };
    const { client, calls } = setup({ ProwlSearch: bySearch({ '@me': [off] }) });
    const result = await fetchPullRequests(
      client,
      opts({ unfollowedTeams: ['acme/off'] }),
      before,
      discovered('acme/off'),
    );
    expect(result.sections.team_review_requested).toEqual([]);
    expect(result.pullRequests).toEqual({});
    expect(calls.some(({ operation }) => operation === 'ProwlNodes')).toBe(false);
    expect(diffSnapshots(before, { ...before, ...result }, 'octocat')).toEqual([]);
  });

  it('pages past filtered PRs until the surviving cap is reached', async () => {
    const off = requested(1, 'acme/off');
    const on = requested(2, 'acme/on');
    const { client, queries } = setup({ ProwlSearch: bySearch({ '@me': [off, off, on] }) });
    const result = await fetchPullRequests(
      client,
      opts({ maxPerSection: 1, unfollowedTeams: ['acme/off'] }),
      null,
      discovered('acme/off', 'acme/on'),
    );
    expect(queries()).toHaveLength(3);
    expect(result.sections.team_review_requested).toEqual([on.id]);
    expect(result.sectionCoverage).toBeUndefined();
  });

  it('searches despite discovery errors and keeps unidentified results', async () => {
    const pr = requested(1, 'acme/off');
    const { client, queries } = setup({ ProwlSearch: bySearch({ '@me': [pr] }) });
    const result = await fetchPullRequests(client, opts({ unfollowedTeams: ['acme/off'] }), null, {
      ...discovered('acme/off'),
      error: { kind: 'server', message: 'Discovery failed' },
    });
    expect(queries()).toHaveLength(1);
    expect(result.sections.team_review_requested).toEqual([pr.id]);
    expect(result.teamRequests).toEqual({});
    expect(result.sectionErrors).toEqual({});
  });

  it('preserves cached membership and section errors when team search fails', async () => {
    const pr = requested(1, 'acme/off');
    const { client } = setup({
      ProwlSearch: () => jsonResponse({ message: 'No access' }, { status: 403 }),
    });
    const result = await fetchPullRequests(
      client,
      opts(),
      { pullRequests: { [pr.id]: mapped(pr) }, sections: { team_review_requested: [pr.id] } },
      { teams: [], error: { kind: 'server', message: 'Discovery failed' } },
    );
    expect(result.sections.team_review_requested).toEqual([pr.id]);
    expect(result.sectionErrors.team_review_requested).toContain('No access');
    expect(result.sectionCoverage?.team_review_requested?.stale).toBe(true);
  });

  it('reports incomplete coverage when switched-off results consume the scan budget', async () => {
    const nodes = Array.from({ length: 110 }, (_, i) => requested(i, 'acme/off'));
    const { client } = setup({ ProwlSearch: bySearch({ '@me': nodes }) });
    const result = await fetchPullRequests(
      client,
      opts({ maxPerSection: 1, unfollowedTeams: ['acme/off'] }),
      null,
      discovered('acme/off'),
    );
    expect(result.sections.team_review_requested).toEqual([]);
    expect(result.sectionCoverage?.team_review_requested?.hasMore).toBe(true);
  });
});
