/**
 * The one cadence policy: whether a poll asked for `reason` may call GitHub now. Every trigger
 * (the poll alarm, startup, the inbox, the CI watch, a focused window, the panel, a person) goes
 * through it, so a rejected token, a backoff and a rate-limit wait stop them all alike. Pure.
 */
import type { PollReason, PollState, Snapshot } from '../model';
import { isWaiting } from './backoff';

const MINUTE = 60_000;
/** The panel refreshes a list older than this when it opens or is shown again. */
export const PANEL_STALE_MS = MINUTE;
/**
 * CI-watch polls run on a list at least this old: on the minute alarm, one every 2 minutes, the
 * floor of the poll interval (10 s of slack for alarm jitter and the poll's own duration).
 */
export const CI_STALE_MS = 2 * MINUTE - 10_000;
/** CI is watched this long after the pull request last changed (a push, a comment). */
export const CI_WATCH_MS = 60 * MINUTE;

export type PollVerdict =
  | { run: true }
  | { run: false; why: 'unauthorized' | 'backoff' | 'rate_limited' | 'fresh' };

/** Reasons a person stands behind: they retry a rejected token and skip the error backoff. */
export const isExplicit = (reason: PollReason) => reason === 'user' || reason === 'change';

/**
 * Reasons that must not share a poll already in flight, which read GitHub (or the settings)
 * before the news: they get one trailing poll once it ends.
 */
export const isTrailing = (reason: PollReason) => reason === 'inbox' || reason === 'change';

/** How old the list must be before `reason` polls it again. */
function staleAfter(reason: PollReason, intervalMinutes: number): number {
  if (reason === 'panel') return PANEL_STALE_MS;
  if (reason === 'focus') return intervalMinutes * MINUTE;
  if (reason === 'ci') return CI_STALE_MS;
  return 0;
}

/**
 * May a poll for `reason` run now? `fetchedAt` is the stored list's (null: none). A list dated in
 * the future (the clock went back) counts as stale. A rate-limit wait (after a rate limit, or a
 * success that left a low budget) holds every reason; an error backoff and a rejected token hold
 * all but explicit ones.
 */
export function pollVerdict(
  reason: PollReason,
  state: PollState,
  fetchedAt: string | null,
  intervalMinutes: number,
  now: number,
): PollVerdict {
  const explicit = isExplicit(reason);
  if (state.lastError?.kind === 'unauthorized' && !explicit)
    return { run: false, why: 'unauthorized' };
  if (isWaiting(state.nextAllowedAt, now)) {
    const backoff = state.lastError !== null && state.lastError.kind !== 'rate_limited';
    if (!backoff) return { run: false, why: 'rate_limited' };
    if (!explicit) return { run: false, why: 'backoff' };
  }
  const age = now - Date.parse(fetchedAt ?? '');
  if (age >= 0 && age < staleAfter(reason, intervalMinutes)) return { run: false, why: 'fresh' };
  return { run: true };
}

/**
 * CI runs (not merely waits) on one of the viewer's own listed open pull requests that changed
 * within `CI_WATCH_MS`: the cue for a `ci` poll until it settles. Only their own, because CI
 * decides whose turn it is only for the author (`whoseTurn`: failing CI, waiting on checks,
 * ready to merge); someone else's CI shows up at the next scheduled poll. Bounded so a check
 * that stays queued, or a clock gone wrong, never keeps the fast cadence for long.
 */
export function ciWatched(snapshot: Snapshot | undefined, now: number): boolean {
  if (!snapshot) return false;
  const viewer = snapshot.viewer.login.toLowerCase();
  return [...new Set(Object.values(snapshot.sections).flat())].some((id) => {
    const pr = snapshot.pullRequests[id];
    if (pr?.state !== 'open' || !pr.checks.running) return false;
    if (pr.author?.login.toLowerCase() !== viewer) return false;
    const age = now - Math.max(Date.parse(pr.lastCommitAt), Date.parse(pr.updatedAt));
    return age >= 0 && age < CI_WATCH_MS;
  });
}
