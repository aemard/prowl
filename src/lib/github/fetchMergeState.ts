/** Merge-fact caching, bounded refreshes and progressive publication during a poll. */
import { hiddenReasons } from '../hidden';
import type { PrLocalState, PullRequest, Snapshot } from '../model';
import { jsonEqual } from '../storage/guards';
import { isSnoozed } from '../storage/prLocal';
import { GitHubError } from './errors';
import type { FetchResult, FetchSettings } from './fetchPullRequests';
import { type MergeFacts, mapMergeState } from './mapPullRequest';
import { MERGE_STATE_QUERY, type MergeStateData } from './queries';

export type ReadGitHub = <T extends { rateLimit: unknown }>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

/** False for a hole (null) and for `{}`, what a fragment on another type selects. */
export const isNode = <T extends { id: string }>(
  node: T | Record<string, never> | null | undefined,
): node is T => typeof node?.id === 'string';

/** PRs per `ProwlMergeState`: about 7 s when GitHub has to compute every one of them. */
const MERGE_STATE_BATCH = 10;
/** Bound expensive GitHub computations even on a cold cache. Remaining PRs wait for a poll. */
const MERGE_STATE_PER_POLL = 20;
/** Merge facts no search field gives away (a base branch that moved on) are read again after this. */
const MERGE_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const HIDDEN_MERGE_STATE_MAX_AGE_MS = 60 * 60 * 1000;

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
export const sameSearchFacts = (a: PullRequest, b: PullRequest) =>
  jsonEqual(searchFacts(a), searchFacts(b));

function staleMergeStates(
  result: FetchResult,
  settings: FetchSettings,
  previous: Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> | null,
  local: PrLocalState,
): PullRequest[] {
  const now = Date.now();
  const stale: PullRequest[] = [];
  const hidden = (pr: PullRequest) =>
    hiddenReasons(pr, settings, now).length > 0 || isSnoozed(local, pr.id, now);
  for (const pr of Object.values(result.pullRequests)) {
    if (pr.state !== 'open') continue;
    const before = previous?.pullRequests[pr.id];
    const readAt = previous?.mergeStateAt?.[pr.id];
    const valid =
      before !== undefined &&
      sameSearchFacts(before, pr) &&
      readAt !== undefined &&
      now - Date.parse(readAt) <
        (hidden(pr) ? HIDDEN_MERGE_STATE_MAX_AGE_MS : MERGE_STATE_MAX_AGE_MS) &&
      before.mergeable !== 'unknown' &&
      before.mergeStateStatus !== 'unknown' &&
      before.reviewDecision !== 'unknown';
    // Preserve the baseline even when this poll has no budget left for its refresh.
    if (before && sameSearchFacts(before, pr)) {
      result.pullRequests[pr.id] = { ...pr, ...mergeFacts(before) };
    } else if (before) {
      result.pullRequests[pr.id] = { ...pr, ...mapMergeState({}) };
    }
    if (before && sameSearchFacts(before, pr) && readAt) result.mergeStateAt[pr.id] = readAt;
    if (!valid) {
      result.mergeStateDue ??= [];
      result.mergeStateDue.push(pr.id);
      stale.push(pr);
    }
  }
  // Visible PRs first, then the oldest successful read so deferred PRs get a turn.
  const age = (pr: PullRequest) => Date.parse(previous?.mergeStateAt?.[pr.id] ?? '') || 0;
  stale.sort((a, b) => Number(hidden(a)) - Number(hidden(b)) || age(a) - age(b));
  return stale;
}

function takeMergeBatch(
  stale: PullRequest[],
  count: number,
  priorityIds: readonly string[],
  previous: Pick<Snapshot, 'mergeStateAt'> | null,
): PullRequest[] {
  const priority = new Map(priorityIds.map((id, index) => [id, index]));
  stale.sort(
    (a, b) =>
      (priority.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (priority.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  // Reserve the last two slots for the oldest reads, even under continuous visible hints.
  const fair =
    count + MERGE_STATE_BATCH >= MERGE_STATE_PER_POLL
      ? [...stale]
          .sort(
            (a, b) =>
              (Date.parse(previous?.mergeStateAt?.[a.id] ?? '') || 0) -
              (Date.parse(previous?.mergeStateAt?.[b.id] ?? '') || 0),
          )
          .slice(0, 2)
      : [];
  const chosen = new Set(
    fair.concat(stale.filter((pr) => !fair.includes(pr)).slice(0, MERGE_STATE_BATCH - fair.length)),
  );
  const batch = stale.filter((pr) => chosen.has(pr));
  for (const pr of batch) stale.splice(stale.indexOf(pr), 1);

  return batch;
}

/**
 * Fills in the merge facts of the PRs found: kept from `previous` while still valid, else read
 * in batches. A batch GitHub gives up on keeps the previous facts and is tried again next poll.
 */
export async function readMergeState({
  result,
  settings,
  previous,
  local,
  read,
  onProgress,
  priorityIds,
  partialErrors = () => [],
  reportPartial,
}: {
  result: FetchResult;
  settings: FetchSettings;
  previous: Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> | null;
  local: PrLocalState;
  read: ReadGitHub;
  onProgress?: (result: FetchResult, mergePending: string[]) => Promise<void>;
  priorityIds: () => readonly string[];
  partialErrors?: () => string[];
  reportPartial?: (id: string, messages: string[]) => void;
}): Promise<void> {
  const stale = staleMergeStates(result, settings, previous, local);
  for (
    let count = 0;
    stale.length > 0 && count < MERGE_STATE_PER_POLL;
    count += MERGE_STATE_BATCH
  ) {
    const batch = takeMergeBatch(stale, count, priorityIds(), previous);

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
    const messages = partialErrors();
    if (messages.length) {
      for (const [id, ids] of Object.entries(result.sections)) {
        if (batch.some((pr) => ids.includes(pr.id))) reportPartial?.(id, messages);
      }
    }
    const readAt = new Date().toISOString();
    batch.forEach((pr, index) => {
      const node = nodes?.[index];
      // A hole or a failed batch leaves the baseline above; facts computed for another head
      // are unknown for this one, and unread, so the next poll asks again.
      if (!isNode(node)) return;
      const sameHead = node.headRefOid === pr.headSha && messages.length === 0;
      result.pullRequests[pr.id] = { ...pr, ...mapMergeState(sameHead ? node : {}) };
      if (sameHead) {
        result.mergeStateAt[pr.id] = readAt;
        result.mergeStateDue = result.mergeStateDue?.filter((id) => id !== pr.id);
      } else {
        delete result.mergeStateAt[pr.id];
      }
    });
  }
  if (result.mergeStateDue?.length === 0) delete result.mergeStateDue;
  await onProgress?.(result, []);
}
