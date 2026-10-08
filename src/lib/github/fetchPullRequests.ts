/**
 * One poll's worth of GitHub reads: every enabled section's search, the merge facts of the PRs
 * that changed, then the final state of the PRs that left all of them. Requests run one after another, as GitHub asks of clients
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
import { type MergeFacts, mapClosedState, mapMergeState, mapPullRequest } from './mapPullRequest';
import {
  MERGE_STATE_QUERY,
  type MergeStateData,
  NODES_QUERY,
  type NodesData,
  SEARCH_QUERY,
  type SearchData,
} from './queries';
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
  'sections' | 'repoInclude' | 'repoExclude' | 'maxPerSection' | 'unfollowedTeams'
>;

const NO_TEAM =
  'GitHub lists no team for your account. An organization that requires single sign-on, or ' +
  'restricts OAuth apps, lists its teams only once it has approved your token or Prowl.';
const NO_FOLLOWED_TEAM = 'You follow none of your teams. Follow one in Settings.';

/** Search page size: about 4 s on busy organizations, inside GitHub's 10 s execution limit. */
const PAGE_SIZE = 25;
/** PRs per `ProwlMergeState`: about 7 s when GitHub has to compute every one of them. */
const MERGE_STATE_BATCH = 10;
/** Merge facts no search field gives away (a base branch that moved on) are read again after this. */
const MERGE_STATE_MAX_AGE_MS = 15 * 60 * 1000;
/** GitHub's maximum for `nodes(ids:)`. */
const IDS_PER_QUERY = 100;
const HAS_SORT = /(?:^|[\s(])sort:/i;
/**
 * Failures about the token, the budget or the connection: the whole poll must back off. A
 * `server` error is usually one heavy search past GitHub's time limit, so it fails that search
 * alone, unless every search failed (`fetchPullRequests`).
 */
const POLL_LEVEL: readonly ErrorKind[] = ['unauthorized', 'rate_limited', 'network'];

const mergeFacts = ({
  reviewDecision,
  mergeable,
  mergeStateStatus,
  viewerCanUpdate,
}: PullRequest): MergeFacts => ({ reviewDecision, mergeable, mergeStateStatus, viewerCanUpdate });

/** What the search says about a PR, for telling whether anything changed since the last poll. */
const searchFacts = (pr: PullRequest) =>
  JSON.stringify({
    ...pr,
    reviewDecision: null,
    mergeable: null,
    mergeStateStatus: null,
    viewerCanUpdate: null,
  });

/** False for a hole (null) and for `{}`, what a fragment on another type selects. */
const isNode = <T extends { id: string }>(
  node: T | Record<string, never> | null | undefined,
): node is T => typeof node?.id === 'string';

/**
 * Fetches every enabled section (`maxPerSection` most recently updated PRs each), dedupes PRs
 * across sections and applies the repo filters. A search GitHub refuses or gives up on, or a
 * custom query that is invalid, is reported in `sectionErrors` while the others still load; so
 * is the team section without `teams` to search. Any other failure throws the `GitHubError`, and
 * so does a `server` error when no search succeeded. Merge facts are read again only for PRs that
 * changed since `previous`, whose facts are unknown or older than `MERGE_STATE_MAX_AGE_MS`; the
 * others keep theirs. Open PRs of `previous` that are no longer in any section are looked up by
 * id: merged or closed ones are kept (in no section) so the diff can tell who merged or closed
 * them; still-open ones are dropped.
 */
export async function fetchPullRequests(
  client: GitHubClient,
  settings: FetchSettings,
  previous: Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> | null = null,
  teams: Pick<TeamsState, 'teams' | 'error'> | null = null,
): Promise<FetchResult> {
  const result: FetchResult = {
    pullRequests: {},
    sections: {},
    sectionErrors: {},
    teamRequests: {},
    mergeStateAt: {},
    rateLimit: null,
  };
  let searched = false;
  let serverError: GitHubError | undefined;

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
      searched = true;
      found.push(...(page.nodes ?? []).filter(isNode).map(mapPullRequest));
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return filterByRepo(found, settings);
  }

  /** A refusal or a timeout that only concerns this search; anything else fails the poll. */
  function sectionLevel(error: unknown): error is GitHubError {
    if (!(error instanceof GitHubError) || POLL_LEVEL.includes(error.kind)) return false;
    if (error.kind === 'server') serverError ??= error;
    return true;
  }

  /**
   * Fills in the merge facts of the PRs found: kept from `previous` while still valid, else read
   * in batches. A batch GitHub gives up on keeps the previous facts and is tried again next poll.
   */
  async function readMergeState(): Promise<void> {
    const now = Date.now();
    const stale: PullRequest[] = [];
    for (const pr of Object.values(result.pullRequests)) {
      const before = previous?.pullRequests[pr.id];
      const readAt = previous?.mergeStateAt?.[pr.id];
      const valid =
        before !== undefined &&
        readAt !== undefined &&
        now - Date.parse(readAt) < MERGE_STATE_MAX_AGE_MS &&
        before.mergeable !== 'unknown' &&
        before.mergeStateStatus !== 'unknown' &&
        searchFacts(before) === searchFacts(pr);
      if (valid) {
        result.pullRequests[pr.id] = { ...pr, ...mergeFacts(before) };
        result.mergeStateAt[pr.id] = readAt;
      } else {
        stale.push(pr);
      }
    }
    for (let start = 0; start < stale.length; start += MERGE_STATE_BATCH) {
      const batch = stale.slice(start, start + MERGE_STATE_BATCH);
      let nodes: MergeStateData['nodes'] = null;
      try {
        ({ nodes } = await read<MergeStateData>(MERGE_STATE_QUERY, {
          ids: batch.map(({ id }) => id),
        }));
      } catch (error) {
        if (!(error instanceof GitHubError) || error.kind !== 'server') throw error;
      }
      const readAt = new Date().toISOString();
      batch.forEach((pr, index) => {
        const node = nodes?.[index];
        const before = previous?.pullRequests[pr.id];
        if (isNode(node)) {
          result.pullRequests[pr.id] = { ...pr, ...mapMergeState(node) };
          result.mergeStateAt[pr.id] = readAt;
        } else if (before) {
          result.pullRequests[pr.id] = { ...pr, ...mergeFacts(before) };
        }
      });
    }
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
      if (!sectionLevel(error)) throw error;
      result.sectionErrors[section.id] = error.message;
    }
  }
  // GitHub itself is failing, not one heavy search: the poll backs off.
  if (!searched && serverError) throw serverError;
  await readMergeState();

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
