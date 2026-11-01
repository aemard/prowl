/** Merge-fact caching, bounded refreshes and progressive publication during a poll. */
import { hiddenReasons } from '../hidden';
import type { PrLocalState, PullRequest, Snapshot } from '../model';
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

/** PRs per expensive merge-state query; at most two batches per poll. */
const MERGE_STATE_BATCH = 10;
const MERGE_STATE_PER_POLL = 20;
const MERGE_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const HIDDEN_MERGE_STATE_MAX_AGE_MS = 60 * 60 * 1000;

const mergeFacts = ({
  reviewDecision,
  mergeable,
  mergeStateStatus,
  viewerCanUpdate,
}: PullRequest): MergeFacts => ({ reviewDecision, mergeable, mergeStateStatus, viewerCanUpdate });

/** Search-visible changes invalidate cached merge facts. */
const searchFacts = (pr: PullRequest) =>
  JSON.stringify({
    ...pr,
    reviewDecision: null,
    mergeable: null,
    mergeStateStatus: null,
    viewerCanUpdate: null,
  });

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
      readAt !== undefined &&
      now - Date.parse(readAt) <
        (hidden(pr) ? HIDDEN_MERGE_STATE_MAX_AGE_MS : MERGE_STATE_MAX_AGE_MS) &&
      before.mergeable !== 'unknown' &&
      before.mergeStateStatus !== 'unknown' &&
      searchFacts(before) === searchFacts(pr);
    // Preserve the baseline even when this poll has no budget left for its refresh.
    if (before) result.pullRequests[pr.id] = { ...pr, ...mergeFacts(before) };
    if (valid) {
      result.mergeStateAt[pr.id] = readAt;
    } else {
      stale.push(pr);
    }
  }
  // Visible PRs first, then the oldest successful read so deferred PRs get a turn.
  const age = (pr: PullRequest) => Date.parse(previous?.mergeStateAt?.[pr.id] ?? '') || 0;
  stale.sort((a, b) => Number(hidden(a)) - Number(hidden(b)) || age(a) - age(b));
  return stale;
}

export async function readMergeState({
  result,
  settings,
  previous,
  local,
  read,
  onProgress,
  priorityIds,
}: {
  result: FetchResult;
  settings: FetchSettings;
  previous: Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> | null;
  local: PrLocalState;
  read: ReadGitHub;
  onProgress?: (result: FetchResult, mergePending: string[]) => Promise<void>;
  priorityIds: () => readonly string[];
}): Promise<void> {
  const stale = staleMergeStates(result, settings, previous, local);
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
    const batch = stale.splice(0, MERGE_STATE_BATCH);
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
  await onProgress?.(result, []);
}
