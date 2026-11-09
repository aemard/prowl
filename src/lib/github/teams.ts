/**
 * Team discovery: the teams the viewer belongs to, for the `team_review_requested` section.
 * REST `GET /user/teams` lists them across organizations in one call; GraphQL has no such
 * field, and every `Team` field there needs `read:org` (see docs/decisions.md).
 */
import type { AuthState, Team, TeamsState } from '../model';
import { TEAM_KEY } from '../storage/settings';
import type { GitHubClient } from './client';
import { GitHubError, isPollBudgetFailure } from './errors';

const PER_PAGE = 100;
/** At most 100 pages, enough for large accounts while bounding discovery. */
export const MAX_TEAMS = 10_000;

const HOUR_MS = 60 * 60 * 1000;
/** A list is refreshed after a day; a failed discovery is retried after an hour. */
const REFRESH_MS = 24 * HOUR_MS;
const RETRY_MS = HOUR_MS;

/** Scopes that include `read:org`. */
const READ_ORG_SCOPES = ['read:org', 'write:org', 'admin:org'];

/** The key a team goes by in settings and snapshots: `org/slug`, lowercase. */
export const teamKey = ({ org, slug }: Pick<Team, 'org' | 'slug'>): string =>
  `${org}/${slug}`.toLowerCase();

/** A classic or OAuth token's scopes include `read:org` (or a scope that implies it). */
export const hasReadOrg = (scopes: readonly string[]): boolean =>
  scopes.some((scope) => READ_ORG_SCOPES.includes(scope));

const MISSING_SCOPE =
  'GitHub would not list your teams. Sign in again with the read:org scope, or use a ' +
  'fine-grained token owned by the organization with the Members: read permission.';

/** A team as GitHub lists it, or null; its key goes into a search query, so it is validated. */
function toTeam(json: unknown): Team | null {
  const { slug, name, organization } = (json ?? {}) as Record<string, unknown>;
  const org = (organization ?? {}) as Record<string, unknown>;
  if (typeof slug !== 'string' || typeof org.login !== 'string') return null;
  if (!TEAM_KEY.test(teamKey({ org: org.login, slug }))) return null;
  return { org: org.login, slug, name: typeof name === 'string' ? name : slug };
}

/**
 * A listed team and its parent: GitHub lists direct memberships only, but a review requested
 * from a parent team reaches the members of its child teams too.
 * ponytail: one level up, the only one `GET /user/teams` returns; grandparents would need a
 * `GET /orgs/{org}/teams/{slug}` per team.
 */
function toTeams(json: unknown): Team[] {
  const { parent, organization } = (json ?? {}) as Record<string, unknown>;
  return [toTeam(json), toTeam({ ...(parent ?? {}), organization })].filter(
    (team) => team !== null,
  );
}

/**
 * The viewer's teams from `GET /user/teams` and their parents, pages of 100 up to `MAX_TEAMS`,
 * sorted by key.
 * Classic and OAuth tokens need `read:org` (GitHub also accepts `repo` or `user`); a
 * fine-grained token must be owned by an organization, with Members: read, and only sees that
 * organization's teams. Throws `GitHubError`.
 */
export async function fetchViewerTeams(
  client: GitHubClient,
  onIncomplete?: () => void,
): Promise<Team[]> {
  const teams: Team[] = [];
  for (let page = 1; page <= MAX_TEAMS / PER_PAGE; page += 1) {
    const batch = await client.rest<unknown>(
      'GET',
      `/user/teams?per_page=${PER_PAGE}&page=${page}`,
    );
    if (!Array.isArray(batch)) {
      throw new GitHubError('server', 'GitHub returned an unexpected response.');
    }
    teams.push(...batch.flatMap(toTeams));
    if (batch.length < PER_PAGE) break;
    if (page === MAX_TEAMS / PER_PAGE) onIncomplete?.();
  }
  const unique = [...new Map(teams.map((team) => [teamKey(team), team])).values()];
  return unique.sort((a, b) => teamKey(a).localeCompare(teamKey(b)));
}

/** Discovery has to run: never for this account, a day after a success, an hour after a failure. */
export function teamsDue(stored: TeamsState | undefined, login: string, now: number): boolean {
  if (stored?.login !== login) return true;
  const age = now - Date.parse(stored.fetchedAt);
  return !(age >= 0 && age < (stored.error ? RETRY_MS : REFRESH_MS));
}

/**
 * Runs `fetchViewerTeams`. A failure is recorded in `error` (`missing_scope` when GitHub refuses
 * a token that lacks `read:org` or is fine-grained) and the previous list of the same account
 * is kept; account-wide failures and no connection are thrown to stop the poll.
 */
export async function discoverTeams(
  client: GitHubClient,
  auth: Pick<AuthState, 'tokenType' | 'scopes' | 'viewer'>,
  previous: TeamsState | undefined,
  now = Date.now(),
): Promise<TeamsState> {
  const login = auth.viewer.login;
  const base = { login, fetchedAt: new Date(now).toISOString() };
  try {
    let incomplete = false;
    const teams = await fetchViewerTeams(client, () => {
      incomplete = true;
    });
    return { ...base, teams, error: null, ...(incomplete ? { incomplete } : {}) };
  } catch (error) {
    if (
      !(error instanceof GitHubError) ||
      isPollBudgetFailure(error.kind) ||
      error.kind === 'network'
    )
      throw error;
    const refused = error.kind === 'forbidden' || error.kind === 'not_found';
    const missingScope = refused && (auth.tokenType === 'fine_grained' || !hasReadOrg(auth.scopes));
    return {
      ...base,
      teams: previous?.login === login ? previous.teams : [],
      error: missingScope
        ? { kind: 'missing_scope', message: MISSING_SCOPE }
        : { kind: error.kind, message: `Could not list your teams: ${error.message}` },
    };
  }
}
