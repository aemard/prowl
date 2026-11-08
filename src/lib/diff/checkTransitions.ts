import type { PullRequest, SettledCheckState, Snapshot } from '../model';

/** `pr`'s check state at the last poll up to `snapshot` that was not pending, when known. */
function settledChecks(snapshot: Snapshot, pr: PullRequest): SettledCheckState | undefined {
  return pr.checks.state === 'pending' ? snapshot.settledChecks?.[pr.id] : pr.checks.state;
}

/**
 * `settledChecks` for the snapshot that follows `prev`: for every PR whose checks are pending
 * in `pullRequests`, the state CI last concluded (from `prev`, or carried over by it). Without
 * it a fix pushed after a failure goes failure -> pending -> success and `ci_passed` is lost.
 */
export function carrySettledChecks(
  prev: Snapshot | null,
  pullRequests: Snapshot['pullRequests'],
): Record<string, SettledCheckState> {
  const carried: Record<string, SettledCheckState> = {};
  for (const pr of Object.values(pullRequests)) {
    const before = prev?.pullRequests[pr.id];
    const settled = prev && before && pr.checks.state === 'pending' && settledChecks(prev, before);
    if (settled) carried[pr.id] = settled;
  }
  return carried;
}

/** An observed CI outcome; pending polls preserve the last conclusion for recovery. */
export function ciOutcome(prev: Snapshot, before: PullRequest, pr: PullRequest) {
  if (
    pr.checks.state === 'failure' &&
    (before.checks.state !== 'failure' || before.headSha !== pr.headSha)
  )
    return 'ci_failed';
  if (pr.checks.state === 'success' && settledChecks(prev, before) === 'failure')
    return 'ci_passed';
  return undefined;
}

/** Maximum retained counters for PRs outside the current snapshot. */
export const CI_OUTCOME_RETAINED = 200;

/**
 * Persist outcome ordinals. GitHub PR node ids are non-integer keys, so insertion order
 * survives JSON persistence. Move only incremented counters last to track change recency.
 * Keep all current PRs and only the most recently changed absent PRs.
 */
export function carryCiOutcomes(
  prev: Snapshot | null,
  pullRequests: Snapshot['pullRequests'],
): Record<string, number> {
  const outcomes = { ...prev?.ciOutcomes };
  for (const pr of Object.values(pullRequests)) {
    const before = prev?.pullRequests[pr.id];
    if (prev && before && ciOutcome(prev, before, pr)) {
      const n = (outcomes[pr.id] ?? 0) + 1;
      delete outcomes[pr.id];
      outcomes[pr.id] = n;
    } else {
      outcomes[pr.id] ??= 0;
    }
  }
  const absent = Object.keys(outcomes).filter((id) => !Object.hasOwn(pullRequests, id));
  for (const id of absent.slice(0, Math.max(0, absent.length - CI_OUTCOME_RETAINED))) {
    delete outcomes[id];
  }
  return outcomes;
}
