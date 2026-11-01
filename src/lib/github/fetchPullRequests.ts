/**
 * One poll's worth of GitHub reads: every enabled section's search, the merge facts of the PRs
 * that left all sections, then merge facts of the PRs that changed. Requests run one after another, as GitHub asks of clients
 * to stay clear of secondary rate limits.
 */
import { hiddenReasons } from '../hidden';
import type {
  ErrorKind,
  PrLocalState,
  PullRequest,
  RateLimit,
  Section,
  SectionCoverage,
  Settings,
  Snapshot,
  TeamsState,
} from '../model';
import { jsonEqual } from '../storage/guards';
import { isSnoozed } from '../storage/prLocal';
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

export interface FetchResult
  extends Pick<
    Snapshot,
    'pullRequests' | 'sections' | 'sectionCoverage' | 'sectionsPending' | 'mergeStateDue'
  > {
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

/** Search page size: about 4 s on busy organizations, inside GitHub's 10 s execution limit. */
const PAGE_SIZE = 25;
/** PRs per `ProwlMergeState`: about 7 s when GitHub has to compute every one of them. */
const MERGE_STATE_BATCH = 10;
/** Merge facts no search field gives away (a base branch that moved on) are read again after this. */
const MERGE_STATE_MAX_AGE_MS = 15 * 60 * 1000;
/** Bound expensive GitHub computations even on a cold cache. Remaining PRs wait for a poll. */
const MERGE_STATE_PER_POLL = 20;
const HIDDEN_MERGE_STATE_MAX_AGE_MS = 60 * 60 * 1000;
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
const searchFacts = (pr: PullRequest) => ({
  ...pr,
  reviewDecision: null,
  mergeable: null,
  mergeStateStatus: null,
  viewerCanUpdate: null,
});
// Chrome storage may reorder keys, including nested ones. Serialization order is not activity.
const sameSearchFacts = (a: PullRequest, b: PullRequest) =>
  jsonEqual(searchFacts(a), searchFacts(b));

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
  previous:
    | (Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> &
        Partial<Pick<Snapshot, 'sections' | 'sectionCoverage'>>)
    | null = null,
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
  let searched = false;
  let serverError: GitHubError | undefined;

  let partialMessages: string[] = [];
  async function read<T extends { rateLimit: unknown }>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    partialMessages = [];
    const data = await client.graphql<T>(query, variables, {
      partial: true,
      onPartialErrors: (messages) => {
        partialMessages = messages;
      },
    });
    result.rateLimit = parseRateLimit(data.rateLimit) ?? result.rateLimit;
    return data;
  }

  type SearchResult = { prs: PullRequest[]; coverage: SectionCoverage; problems: string[] };
  async function search(query: string): Promise<SearchResult> {
    const found = new Map<string, PullRequest>();
    const problems: string[] = [];
    let after: string | null = null;
    let hasMore = false;
    let cut = false;
    let total: number | undefined;
    let examined = 0;
    let pages = 0;
    // Bound both requests and examined nodes: tiny retained limits must not cause hundreds
    // of one-result pages when local repository filters reject every result.
    const scanBudget = Math.min(500, Math.max(100, settings.maxPerSection * 5));
    do {
      const first = Math.min(PAGE_SIZE, settings.maxPerSection - found.size, scanBudget - examined);
      pages++;
      try {
        const data: SearchData = await read<SearchData>(SEARCH_QUERY, { query, first, after });
        const page: SearchData['search'] = data.search;
        searched = true;
        examined += first;
        total = page.issueCount;
        for (const pr of filterByRepo(
          (page.nodes ?? []).filter(isNode).map(mapPullRequest),
          settings,
        )) {
          found.set(pr.id, pr);
        }
        hasMore = page.pageInfo.hasNextPage;
        if (partialMessages.length) problems.push(...partialMessages);
        const cursor: string | null = page.pageInfo.endCursor;
        if (!hasMore) break;
        if (!cursor || cursor === after) {
          problems.push('GitHub did not provide a usable next-page cursor.');
          cut = true;
          break;
        }
        after = cursor;
      } catch (error) {
        if (!sectionLevel(error)) throw error;
        if (examined === 0) throw error;
        problems.push(error.message);
        cut = true;
        break;
      }
    } while (hasMore && found.size < settings.maxPerSection && examined < scanBudget && pages < 20);
    return {
      prs: [...found.values()],
      coverage: {
        hasMore,
        queries: [{ query, cursor: hasMore ? after : null, total }],
        ...(problems.length ? { partial: true } : {}),
        ...(cut ? { stale: true } : {}),
      },
      problems,
    };
  }

  const coverageFor = (id: string, coverage: SectionCoverage) => {
    if (coverage.hasMore || coverage.partial || coverage.stale) {
      result.sectionCoverage ??= {};
      result.sectionCoverage[id] = coverage;
    }
  };
  const put = (pr: PullRequest) => {
    const before = previous?.pullRequests[pr.id];
    result.pullRequests[pr.id] = before
      ? {
          ...pr,
          ...(sameSearchFacts(before, pr) ? mergeFacts(before) : mapMergeState({})),
        }
      : pr;
  };
  /**
   * A search cut short (or refused) cannot tell which PRs left the section: keeps the cached
   * members up to `maxPerSection`, never over a copy this poll loaded.
   */
  const preserve = (section: Section) => {
    const members = new Set(result.sections[section.id]);
    const cached = (previous?.sections?.[section.id] ?? []).flatMap(
      (id) => previous?.pullRequests[id] ?? [],
    );
    for (const pr of filterByRepo(cached, settings)) {
      if (members.size >= settings.maxPerSection) break;
      members.add(pr.id);
      result.pullRequests[pr.id] ??= pr;
    }
    if (members.size) result.sections[section.id] = [...members];
  };
  const problemText = (problems: string[]) =>
    [...new Set(problems.map((message) => (SAML.test(message) ? SSO_REQUIRED : message)))]
      .slice(0, 5)
      .join(' ');

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
    const hidden = (pr: PullRequest) =>
      hiddenReasons(pr, settings, now, local).length > 0 || isSnoozed(local, pr.id, now);
    for (const pr of Object.values(result.pullRequests)) {
      if (pr.state !== 'open') continue;
      const before = previous?.pullRequests[pr.id];
      const readAt = previous?.mergeStateAt?.[pr.id];
      // `put` kept the facts only if the search facts are unchanged; their date goes with them.
      const carried = before !== undefined && sameSearchFacts(before, pr);
      const valid =
        carried &&
        readAt !== undefined &&
        now - Date.parse(readAt) <
          (hidden(pr) ? HIDDEN_MERGE_STATE_MAX_AGE_MS : MERGE_STATE_MAX_AGE_MS) &&
        before.mergeable !== 'unknown' &&
        before.mergeStateStatus !== 'unknown' &&
        before.reviewDecision !== 'unknown';
      if (carried && readAt) result.mergeStateAt[pr.id] = readAt;
      if (!valid) {
        result.mergeStateDue ??= [];
        result.mergeStateDue.push(pr.id);
        stale.push(pr);
      }
    }
    // Visible PRs first, then the oldest successful read so deferred PRs get a turn.
    const age = (pr: PullRequest) => Date.parse(previous?.mergeStateAt?.[pr.id] ?? '') || 0;
    stale.sort((a, b) => Number(hidden(a)) - Number(hidden(b)) || age(a) - age(b));
    for (
      let count = 0;
      stale.length > 0 && count < MERGE_STATE_PER_POLL;
      count += MERGE_STATE_BATCH
    ) {
      const priority = new Map(priorityIds().map((id, index) => [id, index]));
      stale.sort(
        (a, b) =>
          (priority.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (priority.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
      // Reserve the last two slots for the oldest reads, even under continuous visible hints.
      const fair =
        count + MERGE_STATE_BATCH >= MERGE_STATE_PER_POLL
          ? [...stale].sort((a, b) => age(a) - age(b)).slice(0, 2)
          : [];
      const chosen = new Set(
        fair.concat(
          stale.filter((pr) => !fair.includes(pr)).slice(0, MERGE_STATE_BATCH - fair.length),
        ),
      );
      const batch = stale.filter((pr) => chosen.has(pr));
      for (const pr of batch) stale.splice(stale.indexOf(pr), 1);
      await onProgress?.(
        result,
        batch.map(({ id }) => id),
      );
      let nodes: MergeStateData['nodes'] = null;
      try {
        ({ nodes } = await read<MergeStateData>(MERGE_STATE_QUERY, {
          ids: batch.map(({ id }) => id),
        }));
      } catch (error) {
        if (!(error instanceof GitHubError) || error.kind !== 'server') throw error;
      }
      if (partialMessages.length) {
        for (const [sectionId, ids] of Object.entries(result.sections)) {
          if (batch.some((pr) => ids.includes(pr.id))) {
            result.sectionErrors[sectionId] =
              `Some merge requirements could not be read: ${problemText(partialMessages)}`;
            coverageFor(sectionId, {
              hasMore: false,
              queries: [],
              ...result.sectionCoverage?.[sectionId],
              partial: true,
            });
          }
        }
      }
      const readAt = new Date().toISOString();
      batch.forEach((pr, index) => {
        const node = nodes?.[index];
        // A hole or a failed batch keeps the facts `put` carried over. A node computed for
        // another head, or read beside errors (a null `reviewDecision` would mean "no review
        // required"), is unknown and unread, so the next poll asks again.
        if (!isNode(node)) return;
        const readable = node.headRefOid === pr.headSha && partialMessages.length === 0;
        result.pullRequests[pr.id] = { ...pr, ...mapMergeState(readable ? node : {}) };
        if (readable) {
          result.mergeStateAt[pr.id] = readAt;
          result.mergeStateDue = result.mergeStateDue?.filter((id) => id !== pr.id);
        }
      });
    }
    if (result.mergeStateDue?.length === 0) delete result.mergeStateDue;
    await onProgress?.(result, []);
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
    const queries: SectionCoverage['queries'] = [];
    let hasMore = false;
    let stale = false;
    const found = new Map<string, { pr: PullRequest; keys: string[] }>();
    for (const team of followed.slice(0, MAX_TEAM_SEARCHES)) {
      const key = teamKey(team);
      try {
        const query = buildSearchQuery(section, settings, key);
        const page = await search(`${query} sort:updated-desc`);
        queries.push(...page.coverage.queries);
        hasMore ||= page.coverage.hasMore;
        stale ||= page.coverage.stale === true;
        problems.push(...page.problems);
        for (const pr of page.prs) {
          const entry = found.get(pr.id) ?? { pr, keys: [] };
          entry.keys.push(key);
          found.set(pr.id, entry);
        }
      } catch (error) {
        if (!sectionLevel(error)) throw error;
        problems.push(`GitHub refused the search for ${key}: ${error.message}`);
        stale = true;
      }
    }
    if (followed.length > MAX_TEAM_SEARCHES) {
      problems.push(
        `Partial results: ${MAX_TEAM_SEARCHES} of ${followed.length} followed teams searched. Choose teams in Settings.`,
      );
    }
    hasMore ||= found.size > settings.maxPerSection;
    const kept = [...found.values()]
      .sort((a, b) => Date.parse(b.pr.updatedAt) - Date.parse(a.pr.updatedAt))
      .slice(0, settings.maxPerSection);
    for (const { pr, keys } of kept) {
      put(pr);
      result.teamRequests[pr.id] = keys;
    }
    result.sections[section.id] = kept.map(({ pr }) => pr.id);
    if (problems.length > 0) result.sectionErrors[section.id] = problemText(problems);
    if (stale) preserve(section);
    coverageFor(section.id, {
      hasMore,
      queries,
      ...(problems.length ? { partial: true } : {}),
      ...(stale ? { stale: true } : {}),
    });
  }

  const enabled = settings.sections.filter((section) => section.enabled);
  const pending = new Set(enabled.map(({ id }) => id));
  for (const section of enabled) {
    if (section.kind === 'team_review_requested') {
      await searchTeams(section);
    } else {
      const problems = section.kind === 'custom' ? validateCustomQuery(section.query ?? '') : [];
      if (problems.length > 0) {
        result.sectionErrors[section.id] = problems.join(' ');
      } else {
        const query = buildSearchQuery(section, settings);
        try {
          const page = await search(HAS_SORT.test(query) ? query : `${query} sort:updated-desc`);
          for (const pr of page.prs) put(pr);
          result.sections[section.id] = page.prs.map(({ id }) => id);
          if (page.problems.length) result.sectionErrors[section.id] = problemText(page.problems);
          if (page.coverage.stale) preserve(section);
          coverageFor(section.id, page.coverage);
        } catch (error) {
          if (!sectionLevel(error)) throw error;
          result.sectionErrors[section.id] = error.message;
          preserve(section);
          coverageFor(section.id, {
            hasMore: previous?.sectionCoverage?.[section.id]?.hasMore ?? false,
            partial: true,
            stale: true,
            queries: previous?.sectionCoverage?.[section.id]?.queries ?? [],
          });
        }
      }
    }
    pending.delete(section.id);
    if (pending.size > 0 && onProgress) {
      // The sections still to search keep their cached cards, without claiming they were searched.
      const publishing: FetchResult = {
        ...result,
        pullRequests: { ...result.pullRequests },
        sections: { ...result.sections },
        sectionsPending: [...pending],
      };
      for (const id of pending) {
        const ids = previous?.sections?.[id] ?? [];
        publishing.sections[id] = ids;
        for (const prId of ids) {
          const pr = previous?.pullRequests[prId];
          if (pr && !publishing.pullRequests[prId]) publishing.pullRequests[prId] = pr;
        }
      }
      await onProgress(publishing, []);
    }
  }
  // GitHub itself is failing, not one heavy search: the poll backs off.
  if (!searched && serverError) throw serverError;
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
  await readMergeState();
  return result;
}
