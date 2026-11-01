/** One poll's sequential GitHub searches, closure reads and merge enrichment. */
import type {
  ErrorKind,
  PrLocalState,
  PullRequest,
  RateLimit,
  Section,
  Settings,
  Snapshot,
  TeamsState,
} from '../model';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';
import { isNode, readMergeState } from './fetchMergeState';
import { mapClosedState, mapPullRequest } from './mapPullRequest';
import { NODES_QUERY, type NodesData, SEARCH_QUERY, type SearchData } from './queries';
import { parseRateLimit } from './rateLimit';
import { buildSearchQuery, filterByRepo, validateCustomQuery } from './search';
import { MAX_TEAM_SEARCHES, teamKey } from './teams';

export interface FetchResult extends Pick<Snapshot, 'pullRequests' | 'sections'> {
  /** PR id -> when its merge facts were read (see `Snapshot.mergeStateAt`). */
  mergeStateAt: Record<string, string>;
  /** Sections that were skipped or loaded in part, section id -> readable reason. */
  sectionErrors: Record<string, string>;
  /** PR id -> keys of the followed teams whose search returned it (team section only). */
  teamRequests: Record<string, string[]>;
  /** Budget reported by the last response; null when nothing was requested. */
  rateLimit: RateLimit | null;
}

export type FetchSettings = Pick<
  Settings,
  | 'sections'
  | 'repoInclude'
  | 'repoExclude'
  | 'maxPerSection'
  | 'unfollowedTeams'
  | 'hideDrafts'
  | 'hideBots'
  | 'hideStaleAfterDays'
>;

const NO_TEAM =
  'GitHub lists no team for your account. An organization that requires single sign-on, or ' +
  'restricts OAuth apps, lists its teams only once it has approved your token or Prowl.';
const NO_FOLLOWED_TEAM = 'You follow none of your teams. Follow one in Settings.';
/** A search came back with holes where an organization's SAML enforcement refused the token. */
const SSO_REQUIRED =
  'An organization requires single sign-on (SAML) that this token is not authorized for, so ' +
  'its pull requests are missing. Authorize the token for that organization on GitHub.';
const SAML = /\bSAML\b/i;

/** Search pages stay inside GitHub's execution limit; closure reads use its maximum batch. */
const PAGE_SIZE = 25;
const IDS_PER_QUERY = 100;
const HAS_SORT = /(?:^|[\s(])sort:/i;
/** Connection, token and budget failures require poll-level backoff. */
const POLL_LEVEL: readonly ErrorKind[] = ['unauthorized', 'rate_limited', 'network'];

type FetchContext = {
  client: GitHubClient;
  settings: FetchSettings;
  teams: Pick<TeamsState, 'teams' | 'error'> | null;
  result: FetchResult;
  searched: boolean;
  serverError: GitHubError | undefined;
  samlHoles: boolean;
};

async function read<T extends { rateLimit: unknown }>(
  context: FetchContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const { client, result } = context;
  const data = await client.graphql<T>(query, variables, {
    partial: true,
    onPartialErrors: (messages) => {
      if (messages.some((message) => SAML.test(message))) context.samlHoles = true;
    },
  });
  result.rateLimit = parseRateLimit(data.rateLimit) ?? result.rateLimit;
  return data;
}

async function search(context: FetchContext, query: string): Promise<PullRequest[]> {
  const { settings } = context;
  const found: PullRequest[] = [];
  let after: string | null = null;
  for (let offset = 0; offset < settings.maxPerSection; offset += PAGE_SIZE) {
    const first = Math.min(PAGE_SIZE, settings.maxPerSection - offset);
    const { search: page }: SearchData = await read(context, SEARCH_QUERY, { query, first, after });
    context.searched = true;
    found.push(...(page.nodes ?? []).filter(isNode).map(mapPullRequest));
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return filterByRepo(found, settings);
}

/** A refusal or a timeout that only concerns this search; anything else fails the poll. */
function sectionLevel(context: FetchContext, error: unknown): error is GitHubError {
  if (!(error instanceof GitHubError) || POLL_LEVEL.includes(error.kind)) return false;
  if (error.kind === 'server') context.serverError ??= error;
  return true;
}

/**
 * One search per followed team (the first `MAX_TEAM_SEARCHES`), merged newest first and cut
 * to `maxPerSection`. A refused team search is reported; the other teams still load.
 */
async function searchTeams(context: FetchContext, section: Section): Promise<void> {
  const { settings, teams, result } = context;
  const all = teams?.teams ?? [];
  const followed = all.filter((team) => !settings.unfollowedTeams.includes(teamKey(team)));
  if (followed.length === 0) {
    result.sectionErrors[section.id] =
      all.length > 0 ? NO_FOLLOWED_TEAM : (teams?.error?.message ?? NO_TEAM);
    return;
  }
  const problems: string[] = [];
  context.samlHoles = false;
  /** PR id -> the PR and the keys of the teams whose search returned it. */
  const found = new Map<string, { pr: PullRequest; keys: string[] }>();
  for (const team of followed.slice(0, MAX_TEAM_SEARCHES)) {
    const key = teamKey(team);
    try {
      const query = buildSearchQuery(section, settings, key);
      for (const pr of await search(context, `${query} sort:updated-desc`)) {
        const entry = found.get(pr.id) ?? { pr, keys: [] };
        entry.keys.push(key);
        found.set(pr.id, entry);
      }
    } catch (error) {
      if (!sectionLevel(context, error)) throw error;
      problems.push(`GitHub refused the search for ${key}: ${error.message}`);
    }
  }
  if (context.samlHoles) problems.push(SSO_REQUIRED);
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

async function searchSections(context: FetchContext): Promise<void> {
  const { settings, result } = context;
  for (const section of settings.sections) {
    if (!section.enabled) continue;
    if (section.kind === 'team_review_requested') {
      await searchTeams(context, section);
      continue;
    }
    const custom = section.kind === 'custom';
    const problems = custom ? validateCustomQuery(section.query ?? '') : [];
    if (problems.length > 0) {
      result.sectionErrors[section.id] = problems.join(' ');
      continue;
    }
    const query = buildSearchQuery(section, settings);
    context.samlHoles = false;
    try {
      const prs = await search(
        context,
        HAS_SORT.test(query) ? query : `${query} sort:updated-desc`,
      );
      for (const pr of prs) result.pullRequests[pr.id] = pr;
      result.sections[section.id] = [...new Set(prs.map(({ id }) => id))];
      if (context.samlHoles) result.sectionErrors[section.id] = SSO_REQUIRED;
    } catch (error) {
      if (!sectionLevel(context, error)) throw error;
      result.sectionErrors[section.id] = error.message;
    }
  }
  // GitHub itself is failing, not one heavy search: the poll backs off.
  if (!context.searched && context.serverError) throw context.serverError;
}

async function readGone(
  context: FetchContext,
  previous: Pick<Snapshot, 'pullRequests'> | null,
): Promise<void> {
  const { settings, result } = context;
  const gone = filterByRepo(
    Object.values(previous?.pullRequests ?? {}).filter(
      ({ id, state }) => state === 'open' && !(id in result.pullRequests),
    ),
    settings,
  );
  for (let start = 0; start < gone.length; start += IDS_PER_QUERY) {
    const batch = gone.slice(start, start + IDS_PER_QUERY);
    const { nodes } = await read<NodesData>(context, NODES_QUERY, {
      ids: batch.map(({ id }) => id),
    });
    // `nodes` follows the order of `ids`.
    batch.forEach((pr, index) => {
      const node = nodes[index];
      const closed = isNode(node) && mapClosedState(pr, node);
      if (closed) result.pullRequests[pr.id] = closed;
    });
  }
}

/**
 * Fetches every enabled section (`maxPerSection` most recently updated PRs each), dedupes PRs
 * across sections and applies the repo filters. A search GitHub refuses or gives up on, or a
 * custom query that is invalid, is reported in `sectionErrors` while the others still load; so
 * is the team section without `teams` to search. Any other failure throws the `GitHubError`, and
 * so does a `server` error when no search succeeded. Merge facts are read again only for PRs that
 * changed since `previous`, whose facts are unknown or older than `MERGE_STATE_MAX_AGE_MS`; the
 * others keep theirs. At most 20 merge states are fetched per poll, visible PRs first,
 * oldest reads first within each priority. Hidden/snoozed facts last one hour when unchanged;
 * deferred facts keep their values but are marked due for the next poll. Open PRs of `previous` that are no longer in any section are looked up by
 * id: merged or closed ones are kept (in no section) so the diff can tell who merged or closed
 * them; still-open ones are dropped. `onProgress` publishes the list before merge reads,
 * then after each batch, with the ids of the next merge batch (empty when finishing).
 * This call stays alive until enrichment finishes.
 */
export async function fetchPullRequests(
  client: GitHubClient,
  settings: FetchSettings,
  previous: Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> | null = null,
  teams: Pick<TeamsState, 'teams' | 'error'> | null = null,
  local: PrLocalState = { snoozed: {}, muted: {}, seen: {} },
  onProgress?: (result: FetchResult, mergePending: string[]) => Promise<void>,
  priorityIds: () => readonly string[] = () => [],
): Promise<FetchResult> {
  const result: FetchResult = {
    pullRequests: {},
    sections: {},
    sectionErrors: {},
    teamRequests: {},
    mergeStateAt: {},
    rateLimit: null,
  };
  const context: FetchContext = {
    client,
    settings,
    teams,
    result,
    searched: false,
    serverError: undefined,
    samlHoles: false,
  };
  await searchSections(context);
  await readGone(context, previous);
  await readMergeState({
    result,
    settings,
    previous,
    local,
    onProgress,
    priorityIds,
    read: (query, variables) => read(context, query, variables),
  });
  return result;
}
