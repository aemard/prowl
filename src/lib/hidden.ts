/**
 * Which pull requests are kept out of the way: left out of the list, the section counts and the
 * badge (a "Show N hidden" button reveals them), but still fetched and still notified. Pure.
 */
import type { PullRequest, Settings } from './model';

/** Why a pull request is hidden. Each reason is one entry; revealed cards show them all. */
export type HiddenReason = { kind: 'stale'; days: number };

/** The settings that hide pull requests. */
export type HideSettings = Pick<Settings, 'hideStaleAfterDays'>;

const DAY_MS = 86_400_000;

/**
 * Why `pr` is hidden at `now`; empty when it is shown. Stale: its last commit is older than
 * `hideStaleAfterDays` days (0 never hides; an unknown date never hides). Applies to every
 * section alike.
 */
export function hiddenReasons(pr: PullRequest, hide: HideSettings, now: number): HiddenReason[] {
  const reasons: HiddenReason[] = [];
  const age = now - Date.parse(pr.lastCommitAt);
  if (hide.hideStaleAfterDays > 0 && age > hide.hideStaleAfterDays * DAY_MS) {
    reasons.push({ kind: 'stale', days: Math.floor(age / DAY_MS) });
  }
  return reasons;
}

/** What a revealed card says: "No commit for 34 d". */
export function describeHiddenReasons(reasons: HiddenReason[]): string {
  return reasons.map(({ days }) => `No commit for ${days} d`).join(', ');
}
