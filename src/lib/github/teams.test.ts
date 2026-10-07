import { describe, expect, it, vi } from 'vitest';
import { teamJson, userTeamsPage } from '../../../tests/fixtures/github';
import { jsonResponse, rateLimitHeaders } from '../../../tests/fixtures/http';
import type { AuthState, TeamsState } from '../model';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';
import { discoverTeams, fetchViewerTeams, hasReadOrg, MAX_TEAMS, teamKey, teamsDue } from './teams';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** A client whose `GET /user/teams` pages over `teams`, or answers `answer()` instead. */
function setup(teams: ReturnType<typeof teamJson>[], answer?: () => Response | Error) {
  const paths: string[] = [];
  const fetch = vi.fn<FetchLike>(async (url) => {
    const path = url.replace('https://api.github.com', '');
    paths.push(path);
    const out = answer?.() ?? jsonResponse(userTeamsPage(teams, path));
    if (out instanceof Error) throw out;
    return out;
  });
  const client = createGitHubClient({ token: 'ghp_test', apiUrl: 'https://api.github.com', fetch });
  return { client, paths };
}

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => teamJson(`acme/team-${String(i).padStart(3, '0')}`));

describe('teamKey', () => {
  it('is org/slug in lowercase', () => {
    expect(teamKey({ org: 'Acme-Corp', slug: 'core' })).toBe('acme-corp/core');
  });
});

describe('hasReadOrg', () => {
  it.each([
    [['repo', 'read:org'], true],
    [['write:org'], true],
    [['admin:org'], true],
    [['repo', 'user'], false],
    [[], false],
  ])('%j -> %s', (scopes, expected) => {
    expect(hasReadOrg(scopes)).toBe(expected);
  });
});

describe('fetchViewerTeams', () => {
  it('maps and sorts the teams GitHub lists', async () => {
    const { client, paths } = setup([
      teamJson('octo-org/web', 'Web'),
      teamJson('Acme/core', 'Core'),
      { ...teamJson('acme/no-name'), name: null as unknown as string },
      {
        ...teamJson('acme/x'),
        organization: null as unknown as ReturnType<typeof teamJson>['organization'],
      },
      null as unknown as ReturnType<typeof teamJson>,
    ]);
    expect(await fetchViewerTeams(client)).toEqual([
      { org: 'Acme', slug: 'core', name: 'Core' },
      { org: 'acme', slug: 'no-name', name: 'no-name' },
      { org: 'octo-org', slug: 'web', name: 'Web' },
    ]);
    expect(paths).toEqual(['/user/teams?per_page=100&page=1']);
  });

  it('follows the pages up to the cap', async () => {
    const { client, paths } = setup(many(105));
    expect(await fetchViewerTeams(client)).toHaveLength(105);
    expect(paths).toEqual(['/user/teams?per_page=100&page=1', '/user/teams?per_page=100&page=2']);

    const capped = setup(many(MAX_TEAMS + 50));
    expect(await fetchViewerTeams(capped.client)).toHaveLength(MAX_TEAMS);
    expect(capped.paths).toHaveLength(MAX_TEAMS / 100);
  });

  it('rejects an answer that is not a list', async () => {
    const { client } = setup([], () => jsonResponse({ message: 'nope' }));
    await expect(fetchViewerTeams(client)).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('teamsDue', () => {
  const stored = (hoursAgo: number, error: TeamsState['error'] = null): TeamsState => ({
    login: 'octocat',
    fetchedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    teams: [],
    error,
  });
  const failed = { kind: 'server', message: 'Down.' } as const;

  it.each([
    ['nothing is stored', undefined, true],
    ['the list is a day old', stored(24), true],
    ['the list is fresh', stored(23.9), false],
    ['a failure is an hour old', stored(1, failed), true],
    ['a failure is recent', stored(0.9, failed), false],
    ['the time is in the future (clock went back)', stored(-1), true],
    ['the time is junk', { ...stored(0), fetchedAt: 'soon' }, true],
    ['the list is another account’s', { ...stored(0), login: 'hubot' }, true],
  ])('%s: %s', (_, value, expected) => {
    expect(teamsDue(value, 'octocat', NOW)).toBe(expected);
  });
});

describe('discoverTeams', () => {
  const auth = (overrides: Partial<AuthState> = {}) => ({
    tokenType: 'classic' as const,
    scopes: ['repo', 'read:org'],
    viewer: { login: 'octocat', avatarUrl: '', name: null },
    ...overrides,
  });
  const previous: TeamsState = {
    login: 'octocat',
    fetchedAt: '2026-10-06T12:00:00.000Z',
    teams: [{ org: 'acme', slug: 'old', name: 'Old' }],
    error: null,
  };
  const forbidden = () => jsonResponse({ message: 'Resource not accessible' }, { status: 403 });
  const notFound = () => jsonResponse({ message: 'Not Found' }, { status: 404 });

  it('stores the list for the viewer', async () => {
    const { client } = setup([teamJson('acme/core', 'Core')]);
    expect(await discoverTeams(client, auth(), previous, NOW)).toEqual({
      login: 'octocat',
      fetchedAt: new Date(NOW).toISOString(),
      teams: [{ org: 'acme', slug: 'core', name: 'Core' }],
      error: null,
    });
  });

  it.each([
    ['a classic token without read:org', auth({ scopes: ['repo'] }), forbidden],
    ['a fine-grained token', auth({ tokenType: 'fine_grained', scopes: [] }), notFound],
  ])('reports a missing scope for %s and keeps the previous list', async (_, who, answer) => {
    const { client } = setup([], answer);
    const result = await discoverTeams(client, who, previous, NOW);
    expect(result.teams).toEqual(previous.teams);
    expect(result.error?.kind).toBe('missing_scope');
    expect(result.error?.message).toMatch(/read:org.*Members: read/);
  });

  it.each([
    ['forbidden', forbidden, 'Resource not accessible'],
    ['server', () => jsonResponse({ message: 'Server Error' }, { status: 502 }), 'Server Error'],
    [
      'rate_limited',
      () =>
        jsonResponse(
          { message: 'API rate limit exceeded' },
          { status: 403, headers: rateLimitHeaders({ remaining: 0 }) },
        ),
      'API rate limit exceeded',
    ],
  ] as const)('records any other refusal (%s) as is', async (kind, answer, message) => {
    const { client } = setup([], answer);
    const result = await discoverTeams(client, auth(), { ...previous, login: 'hubot' }, NOW);
    expect(result).toEqual({
      login: 'octocat',
      fetchedAt: new Date(NOW).toISOString(),
      teams: [],
      error: { kind, message: `Could not list your teams: ${message}` },
    });
  });

  it.each([
    ['unauthorized', () => jsonResponse({ message: 'Bad credentials' }, { status: 401 })],
    ['network', () => new TypeError('Failed to fetch')],
  ] as const)('throws %s, which fails the whole poll', async (kind, answer) => {
    const { client } = setup([], answer);
    await expect(discoverTeams(client, auth(), undefined, NOW)).rejects.toMatchObject({ kind });
  });

  it('throws what is not a GitHub failure', async () => {
    const bug = new RangeError('bug');
    const client = { rest: () => Promise.reject(bug) } as unknown as Parameters<
      typeof discoverTeams
    >[0];
    await expect(discoverTeams(client, auth(), undefined)).rejects.toBe(bug);
    expect(bug).not.toBeInstanceOf(GitHubError);
  });
});
