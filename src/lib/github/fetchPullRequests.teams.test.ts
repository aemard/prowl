import { describe, expect, it } from 'vitest';
import { prNode, searchResponse } from '../../../tests/fixtures/github';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import type { Team, TeamsState } from '../model';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, section, settings, setup } from './fetchPullRequests.test-support';
import { MAX_TEAM_SEARCHES } from './teams';

describe('fetchPullRequests', () => {
  describe('team reviews', () => {
    const teamSection = section('team_review_requested');
    const team = (key: string): Team => {
      const [org = '', slug = ''] = key.split('/');
      return { org, slug, name: slug };
    };
    const discovered = (...keys: string[]) => ({ teams: keys.map(team), error: null });
    const at = (number: number, updatedAt: string) => prNode({ number, updatedAt });

    it('searches each followed team and merges the results newest first, capped', async () => {
      const [old, mid, recent, newest] = [
        at(1, '2026-10-01T00:00:00Z'),
        at(2, '2026-10-02T00:00:00Z'),
        at(3, '2026-10-03T00:00:00Z'),
        at(4, '2026-10-04T00:00:00Z'),
      ];
      const { client, queries } = setup({
        ProwlSearch: bySearch({
          'team-review-requested:acme/core ': [recent, old],
          'team-review-requested:acme/web ': [newest, recent, mid],
        }),
      });
      const result = await fetchPullRequests(
        client,
        settings({
          sections: [teamSection],
          maxPerSection: 3,
          repoExclude: ['acme/old'],
          unfollowedTeams: ['acme/docs'],
        }),
        null,
        discovered('Acme/Core', 'acme/docs', 'acme/web'),
      );

      expect(queries().map(({ query }) => query)).toEqual([
        'is:pr is:open team-review-requested:acme/core archived:false -repo:acme/old sort:updated-desc',
        'is:pr is:open team-review-requested:acme/web archived:false -repo:acme/old sort:updated-desc',
      ]);
      expect(result.sections).toEqual({
        team_review_requested: [newest.id, recent.id, mid.id],
      });
      expect(Object.keys(result.pullRequests)).toEqual([newest.id, recent.id, mid.id]);
      expect(result.teamRequests).toEqual({
        [newest.id]: ['acme/web'],
        [recent.id]: ['acme/core', 'acme/web'],
        [mid.id]: ['acme/web'],
      });
      expect(result.sectionErrors).toEqual({});
    });

    const missingScope: Pick<TeamsState, 'teams' | 'error'> = {
      teams: [],
      error: { kind: 'missing_scope', message: 'Needs read:org.' },
    };
    it.each([
      ['no team list', null, /GitHub lists no team for your account/],
      ['no team', discovered(), /GitHub lists no team for your account/],
      ['a failed discovery', missingScope, /^Needs read:org\.$/],
    ])('reports %s without searching', async (_, teams, message) => {
      const { client, calls } = setup({});
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        teams,
      );
      expect(calls).toEqual([]);
      expect(result.sectionErrors.team_review_requested).toMatch(message);
      expect(result.sections).toEqual({});
    });

    it('asks to follow a team when every team is unfollowed', async () => {
      const { client, calls } = setup({});
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection], unfollowedTeams: ['acme/core'] }),
        null,
        { teams: [team('acme/core')], error: { kind: 'server', message: 'Down.' } },
      );
      expect(calls).toEqual([]);
      expect(result.sectionErrors).toEqual({
        team_review_requested: 'You follow none of your teams. Follow one in Settings.',
      });
    });

    it('searches a stale list when the last discovery failed', async () => {
      const pr = prNode();
      const { client } = setup({ ProwlSearch: bySearch({ 'acme/core': [pr] }) });
      const result = await fetchPullRequests(client, settings({ sections: [teamSection] }), null, {
        teams: [team('acme/core')],
        error: { kind: 'server', message: 'Down.' },
      });
      expect(result.sections).toEqual({ team_review_requested: [pr.id] });
      expect(result.sectionErrors).toEqual({});
    });

    it('reports a refused team search and keeps the teams that loaded', async () => {
      const pr = prNode();
      const { client } = setup({
        ProwlSearch: (variables) =>
          String(variables.query).includes('acme/gone')
            ? jsonResponse({ message: 'Validation Failed' }, { status: 422 })
            : searchResponse([pr], variables),
      });
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        discovered('acme/core', 'acme/gone'),
      );
      expect(result.sections).toEqual({ team_review_requested: [pr.id] });
      expect(result.teamRequests).toEqual({ [pr.id]: ['acme/core'] });
      expect(result.sectionErrors).toEqual({
        team_review_requested: 'GitHub refused the search for acme/gone: Validation Failed',
      });
    });

    it("says when an organization's SAML enforcement left holes in a team search", async () => {
      const pr = prNode();
      const { client } = setup({
        ProwlSearch: (variables) =>
          jsonResponse({
            data: searchResponse([pr], variables),
            ...(String(variables.query).includes('acme/sso')
              ? {
                  errors: [
                    graphqlError(
                      'FORBIDDEN',
                      'Resource protected by organization SAML enforcement.',
                    ),
                  ],
                }
              : {}),
          }),
      });
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        discovered('acme/core', 'acme/sso'),
      );
      expect(result.sections).toEqual({ team_review_requested: [pr.id] });
      expect(result.sectionErrors.team_review_requested).toMatch(
        /^An organization requires single sign-on \(SAML\)/,
      );
    });

    it('throws what fails the whole poll', async () => {
      const { client } = setup({
        ProwlSearch: () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
      });
      await expect(
        fetchPullRequests(client, settings({ sections: [teamSection] }), null, discovered('a/b')),
      ).rejects.toMatchObject({ kind: 'unauthorized' });
    });

    it(`searches the first ${MAX_TEAM_SEARCHES} followed teams and says how many it skipped`, async () => {
      const keys = Array.from({ length: MAX_TEAM_SEARCHES + 2 }, (_, i) => `acme/t${i + 10}`);
      const { client, queries } = setup({ ProwlSearch: bySearch({}) });
      const result = await fetchPullRequests(
        client,
        settings({ sections: [teamSection] }),
        null,
        discovered(...keys),
      );
      expect(queries()).toHaveLength(MAX_TEAM_SEARCHES);
      expect(result.sections).toEqual({ team_review_requested: [] });
      expect(result.sectionErrors.team_review_requested).toBe(
        `Prowl searches ${MAX_TEAM_SEARCHES} teams at most, 2 more were skipped. Unfollow teams in Settings to choose which.`,
      );
    });
  });
});
