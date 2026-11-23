/**
 * One poll's worth of GitHub reads: every enabled section's search, the merge facts of the PRs
 * that left all sections, then merge facts of the PRs that changed. Requests run one after
 * another, as GitHub asks of clients to stay clear of secondary rate limits.
 */
import { t } from '../i18n';
import type { PrLocalState, RateLimit, Settings, Snapshot, TeamsState } from '../model';
import type { GitHubClient } from './client';
import { isNode, readMergeState } from './fetchMergeState';
import { SearchContext } from './fetchSearch';
import { mapClosedState } from './mapPullRequest';
import { NODES_QUERY, type NodesData } from './queries';
import { filterByRepo, sectionScopes } from './search';

export interface FetchResult
  extends Pick<
    Snapshot,
    'pullRequests' | 'sections' | 'sectionCoverage' | 'sectionsPending' | 'mergeStateDue'
  > {
  /** What each searched section asked for (see `Snapshot.sectionScopes`). */
  sectionScopes: Record<string, string>;
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

const IDS_PER_QUERY = 100;
/**
 * Fetches every enabled section (`maxPerSection` most recently updated PRs each), dedupes PRs
 * across sections and applies the repo filters. A search GitHub refuses or gives up on, or a
 * custom query that is invalid, is reported in `sectionErrors` while the others still load; so
 * is the team section without `teams` to search. Any other failure throws the `GitHubError`, and
 * so does a `server` error when no search succeeded. Merge facts are read again only for PRs that
 * changed since `previous`, whose facts are unknown or older than `MERGE_STATE_MAX_AGE_MS`; the
 * others keep theirs. At most 20 merge states are fetched per poll, visible PRs first,
 * oldest reads first within each priority. Snoozed facts last one hour when unchanged;
 * deferred facts keep their values but are marked due for the next poll. Open PRs of `previous` that are no longer in any section are looked up by
 * id: merged or closed ones are kept (in no section) so the diff can tell who merged or closed
 * them; still-open ones are dropped. `onProgress` publishes completed sections during search, then the list before merge reads,
 * then after each batch, with the ids of the next merge batch (empty when finishing).
 * This call stays alive until enrichment finishes.
 */
export async function fetchPullRequests(
  client: GitHubClient,
  settings: FetchSettings,
  previous:
    | (Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> &
        Partial<Pick<Snapshot, 'sections' | 'sectionCoverage' | 'teamRequests' | 'sectionScopes'>>)
    | null = null,
  teams: Pick<TeamsState, 'teams' | 'error' | 'incomplete'> | null = null,
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
    sectionScopes: sectionScopes(settings),
    rateLimit: null,
  };
  const context = new SearchContext(client, settings, previous, teams, result);
  await searchSections(context, onProgress);
  await readGone(context);
  await readMergeState({
    result,
    settings,
    previous,
    local,
    read: (query, variables) => context.read(query, variables),
    onProgress,
    priorityIds,
    partialErrors: context.partialErrors,
    reportPartial: (id, messages) => {
      result.sectionErrors[id] = t('mergeRequirementsUnreadable', context.problemText(messages));
      context.coverageFor(id, {
        hasMore: false,
        queries: [],
        ...result.sectionCoverage?.[id],
        partial: true,
      });
    },
  });
  return result;
}

function pendingPublication(context: SearchContext, pending: Set<string>): FetchResult {
  const { result, previous } = context;
  // The sections still to search keep their cached cards, without claiming they were searched.
  const publishing: FetchResult = {
    ...result,
    pullRequests: { ...result.pullRequests },
    sections: { ...result.sections },
    teamRequests: { ...result.teamRequests },
    sectionScopes: { ...result.sectionScopes },
    sectionsPending: [...pending],
  };
  for (const id of pending) {
    const ids = previous?.sections?.[id] ?? [];
    publishing.sections[id] = ids;
    // Searched as the previous poll did, if at all: what this poll's search finds is new to it.
    const scope = previous?.sectionScopes?.[id];
    if (scope === undefined) delete publishing.sectionScopes[id];
    else publishing.sectionScopes[id] = scope;
    for (const prId of ids) {
      const pr = previous?.pullRequests[prId];
      if (pr && !publishing.pullRequests[prId]) publishing.pullRequests[prId] = pr;
      const keys = previous?.teamRequests?.[prId];
      if (keys) publishing.teamRequests[prId] ??= keys;
    }
  }
  return publishing;
}

async function searchSections(
  context: SearchContext,
  onProgress?: (result: FetchResult, mergePending: string[]) => Promise<void>,
) {
  const { settings } = context;
  // "Your turn" lists the other sections' PRs (`yourTurnIds`): there is nothing to search.
  const enabled = settings.sections.filter(
    (section) => section.enabled && section.kind !== 'your_turn',
  );
  const pending = new Set(enabled.map(({ id }) => id));
  for (const section of enabled) {
    await context.searchSection(section);
    pending.delete(section.id);
    if (pending.size > 0 && onProgress) {
      await onProgress(pendingPublication(context, pending), []);
    }
  }
  // GitHub itself is failing, not one heavy search: the poll backs off.
  context.checkSearches();
}

async function readGone(context: SearchContext) {
  const { settings, result, previous } = context;
  const gone = filterByRepo(
    Object.values(previous?.pullRequests ?? {}).filter(
      ({ id, state }) =>
        state === 'open' && !(id in result.pullRequests) && !context.excludedPrs.has(id),
    ),
    settings,
  );
  for (let start = 0; start < gone.length; start += IDS_PER_QUERY) {
    const batch = gone.slice(start, start + IDS_PER_QUERY);
    const { nodes } = await context.read<NodesData>(NODES_QUERY, {
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
