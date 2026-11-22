/**
 * Whether GitHub would merge a pull request now, and whether anyone has to: the one rule the
 * diff engine, "whose turn", the badge, the stacks and the card's chips and merge controls share.
 * Pure and dependency-free, so none of them imports another to reach it.
 */
import type { PullRequest } from './model';

/**
 * Open, not a draft, mergeable, and GitHub's verdict lets it through (`clean`; `unstable` means
 * only a check that is not required fails; `has_hooks`) with its review requirement met or
 * absent. Local facts never override a `blocked`, `behind` or `unknown` verdict.
 */
export function isReadyToMerge(pr: PullRequest): boolean {
  return (
    pr.state === 'open' &&
    !pr.isDraft &&
    pr.mergeable === 'mergeable' &&
    ['clean', 'unstable', 'has_hooks'].includes(pr.mergeStateStatus) &&
    (pr.reviewDecision === 'approved' || pr.reviewDecision === 'none')
  );
}

/**
 * GitHub merges it without anyone's click: auto-merge is on, or it sits in a merge queue.
 * Such a PR is neither news when it turns ready nor anyone's move.
 */
export const mergesItself = (pr: PullRequest): boolean =>
  pr.state === 'open' && (pr.autoMerge !== null || pr.inMergeQueue === true);

/** Ready, and waiting for someone to merge it (see `mergesItself`). */
export const awaitsMerge = (pr: PullRequest): boolean => isReadyToMerge(pr) && !mergesItself(pr);
