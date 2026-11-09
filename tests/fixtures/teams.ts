const WEB = 'https://github.com';
const AVATAR = 'https://avatars.githubusercontent.com/u/583231?s=64&v=4';
/** One item of REST `GET /user/teams` (GitHub's "Full Team"), for `org/slug`. */
export function teamJson(key = 'acme/core', name = 'Core') {
  const [org = '', slug = ''] = key.split('/');
  return {
    id: 4_200_001,
    node_id: 'T_kwDOAAAB0c4AQBIx',
    url: `https://api.github.com/organizations/1001/team/4200001`,
    html_url: `${WEB}/orgs/${org}/teams/${slug}`,
    name,
    slug,
    description: null,
    privacy: 'closed',
    notification_setting: 'notifications_enabled',
    permission: 'pull',
    parent: null as { slug: string; name: string } | null,
    members_count: 4,
    repos_count: 2,
    created_at: '2024-02-01T09:00:00Z',
    updated_at: '2026-09-30T09:00:00Z',
    organization: {
      login: org,
      id: 1001,
      node_id: 'O_kgDOAAAD6Q',
      url: `https://api.github.com/orgs/${org}`,
      avatar_url: AVATAR,
      description: null,
    },
  };
}

/**
 * A REST answer for `GET /user/teams?per_page&page`, paged like GitHub (`teams` is every team,
 * `path` the request path with its query).
 */
export function userTeamsPage(teams: ReturnType<typeof teamJson>[], path: string) {
  const params = new URL(path, 'https://api.github.com').searchParams;
  const perPage = Number(params.get('per_page') ?? 30);
  const page = Number(params.get('page') ?? 1);
  return teams.slice((page - 1) * perPage, page * perPage);
}
