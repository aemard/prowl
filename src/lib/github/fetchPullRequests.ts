/**
 * One poll's worth of GitHub reads: every enabled section's search, then the final state of
 * the PRs that left all of them. Requests run one after another, as GitHub asks of clients
 * to stay clear of secondary rate limits.
 */
import type {
  ErrorKind,
  PullRequest,
  RateLimit,
  Section,
  Settings,
  Snapshot,
  TeamsState,
} from '../model';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';
import { mapClosedState, mapPullRequest } from './mapPullRequest';
import { NODES_QUERY, type NodesData, SEARCH_QUERY, type SearchData } from './queries';
import { parseRateLimit } from './rateLimit';
import { buildSearchQuery, filterByRepo, validateCustomQuery } from './search';
import { MAX_TEAM_SEARCHES, teamKey } from './teams';

export interface FetchResult extends Pick<Snapshot, 'pullRequests' | 'sections'> {
  /** Sections that were skipped or loaded in part, section id -> readable reason. */
  sectionErrors: Record<string, string>;
  /** PR id -> keys of the followed teams whose search returned it (team section only). */
  teamRequests: Record<string, string[]>;
  /** Budget reported by the last response; null when nothing was requested. */
  rateLimit: RateLimit | null;
}

export type FetchSettings = Pick<
  Settings,
  'sections' | 'repoInclude' | 'repoExclude' | 'maxPerSection' | 'unfollowedTeams'
>;

const NO_TEAM =
  'GitHub lists no team for your account. An organization that requires single sign-on, or ' +
  'restricts OAuth apps, lists its teams only once it has approved your token or Prowl.';
const NO_FOLLOWED_TEAM = 'You follow none of your teams. Follow one in Settings.';

/** Search page size: keeps each request well inside GitHub's 10 s execution limit. */
const PAGE_SIZE = 50;
/** GitHub's maximum for `nodes(ids:)`. */
const IDS_PER_QUERY = 100;
const HAS_SORT = /(?:^|[\s(])sort:/i;
/** Failures about the token, the budget or GitHub itself: the whole poll must back off. */
const POLL_LEVEL: readonly ErrorKind[] = ['unauthorized', 'rate_limited', 'network', 'server'];

/** False for a hole (null) and for `{}`, what a fragment on another type selects. */
const isNode = <T extends { id: string }>(
  node: T | Record<string, never> | null | undefined,
): node is T => typeof node?.id === 'string';

/**
 * Fetches every enabled section (`maxPerSection` most recently updated PRs each), dedupes PRs
 * across sections and applies the repo filters. A custom section whose query is invalid, or
 * that GitHub refuses, is reported in `sectionErrors` while the others still load; so is the
 * team section without `teams` to search, or with team searches GitHub refused. Any other
 * failure throws the `GitHubError`. Open PRs of `previous` that are no longer in any section
 * are looked up by id: merged or closed ones are kept (in no section) so the diff can tell
 * who merged or closed them; still-open ones are dropped.
 */
export async function fetchPullRequests(
  client: GitHubClient,
  settings: FetchSettings,
  previous: Pick<Snapshot, 'pullRequests'> | null = null,
  teams: Pick<TeamsState, 'teams' | 'error'> | null = null,
): Promise<FetchResult> {
  const result: FetchResult = {
    pullRequests: {},
    sections: {},
    sectionErrors: {},
    teamRequests: {},
    rateLimit: null,
  };

  // Holes (an org that requires SAML, a deleted PR) leave null nodes and are skipped.
  // ponytail: they are skipped silently; no "some PRs could not be loaded" notice yet.
  async function read<T extends { rateLimit: unknown }>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const data = await client.graphql<T>(query, variables, { partial: true });
    result.rateLimit = parseRateLimit(data.rateLimit) ?? result.rateLimit;
    return data;
  }

  async function search(query: string): Promise<PullRequest[]> {
    const found: PullRequest[] = [];
    let after: string | null = null;
    for (let offset = 0; offset < settings.maxPerSection; offset += PAGE_SIZE) {
      const first = Math.min(PAGE_SIZE, settings.maxPerSection - offset);
      const { search: page }: SearchData = await read(SEARCH_QUERY, { query, first, after });
      found.push(...(page.nodes ?? []).filter(isNode).map(mapPullRequest));
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return filterByRepo(found, settings);
  }

  /** A refusal that only concerns this search; anything else fails the poll. */
  function sectionLevel(error: unknown): error is GitHubError {
    return error instanceof GitHubError && !POLL_LEVEL.includes(error.kind);
  }

  /**
   * One search per followed team (the first `MAX_TEAM_SEARCHES`), merged newest first and cut
   * to `maxPerSection`. A refused team search is reported; the other teams still load.
   */
  async function searchTeams(section: Section): Promise<void> {
    const all = teams?.teams ?? [];
    const followed = all.filter((team) => !settings.unfollowedTeams.includes(teamKey(team)));
    if (followed.length === 0) {
      result.sectionErrors[section.id] =
        all.length > 0 ? NO_FOLLOWED_TEAM : (teams?.error?.message ?? NO_TEAM);
      return;
    }
    const problems: string[] = [];
    /** PR id -> the PR and the keys of the teams whose search returned it. */
    const found = new Map<string, { pr: PullRequest; keys: string[] }>();
    for (const team of followed.slice(0, MAX_TEAM_SEARCHES)) {
      const key = teamKey(team);
      try {
        const query = buildSearchQuery(section, settings, key);
        for (const pr of await search(`${query} sort:updated-desc`)) {
          const entry = found.get(pr.id) ?? { pr, keys: [] };
          entry.keys.push(key);
          found.set(pr.id, entry);
        }
      } catch (error) {
        if (!sectionLevel(error)) throw error;
        problems.push(`GitHub refused the search for ${key}: ${error.message}`);
      }
    }
    const skipped = followed.length - MAX_TEAM_SEARCHES;
    if (skipped > 0) {
      problems.push(
        `Prowl searches ${MAX_TEAM_SEARCHES} teams at most, ${skipped} more were skipped. ` +
          'Unfollow teams in Settings to choose which.',
      );
    }
    const kept = [...found.values()]
      .sort((a, b) => Date.parse(b.pr.updatedAt) - Date.parse(a.pr.updatedAt))
      .slice(0, settings.maxPerSection);
    for (const { pr, keys } of kept) {
      result.pullRequests[pr.id] = pr;
      result.teamRequests[pr.id] = keys;
    }
    result.sections[section.id] = kept.map(({ pr }) => pr.id);
    if (problems.length > 0) result.sectionErrors[section.id] = problems.join(' ');
  }

  for (const section of settings.sections) {
    if (!section.enabled) continue;
    if (section.kind === 'team_review_requested') {
      await searchTeams(section);
      continue;
    }
    const custom = section.kind === 'custom';
    const problems = custom ? validateCustomQuery(section.query ?? '') : [];
    if (problems.length > 0) {
      result.sectionErrors[section.id] = problems.join(' ');
      continue;
    }
    const query = buildSearchQuery(section, settings);
    try {
      const prs = await search(HAS_SORT.test(query) ? query : `${query} sort:updated-desc`);
      for (const pr of prs) result.pullRequests[pr.id] = pr;
      result.sections[section.id] = [...new Set(prs.map(({ id }) => id))];
    } catch (error) {
      if (!custom || !sectionLevel(error)) throw error;
      result.sectionErrors[section.id] = error.message;
    }
  }

  const gone = filterByRepo(
    Object.values(previous?.pullRequests ?? {}).filter(
      ({ id, state }) => state === 'open' && !(id in result.pullRequests),
    ),
    settings,
  );
  for (let start = 0; start < gone.length; start += IDS_PER_QUERY) {
    const batch = gone.slice(start, start + IDS_PER_QUERY);
    const { nodes } = await read<NodesData>(NODES_QUERY, { ids: batch.map(({ id }) => id) });
    // `nodes` follows the order of `ids`.
    batch.forEach((pr, index) => {
      const node = nodes[index];
      const closed = isNode(node) && mapClosedState(pr, node);
      if (closed) result.pullRequests[pr.id] = closed;
    });
  }
  return result;
}
