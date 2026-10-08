/**
 * Which pull requests are kept out of the way: left out of the list, the section counts and the
 * badge (a "Show N hidden" button reveals them), but still fetched and still notified. Pure.
 */
import type { PullRequest, Settings } from './model';

/** Why a pull request is hidden. Each reason is one entry; revealed cards show them all. */
export type HiddenReason = { kind: 'draft' } | { kind: 'bot' } | { kind: 'stale'; days: number };

/** The settings that hide pull requests. */
export type HideSettings = Pick<Settings, 'hideDrafts' | 'hideBots' | 'hideStaleAfterDays'>;

const DAY_MS = 86_400_000;

/**
 * Why `pr` is hidden at `now`, in the order drafts, bots, stale; empty when it is shown. Draft:
 * `hideDrafts` and the PR is a draft. Bot: `hideBots` and its author is a bot. Stale: its last
 * commit is older than `hideStaleAfterDays` days (0 never hides; an unknown date never hides).
 * Applies to every section alike.
 */
export function hiddenReasons(pr: PullRequest, hide: HideSettings, now: number): HiddenReason[] {
  const reasons: HiddenReason[] = [];
  if (hide.hideDrafts && pr.isDraft) reasons.push({ kind: 'draft' });
  if (hide.hideBots && pr.author?.isBot) reasons.push({ kind: 'bot' });
  const age = now - Date.parse(pr.lastCommitAt);
  if (hide.hideStaleAfterDays > 0 && age > hide.hideStaleAfterDays * DAY_MS) {
    reasons.push({ kind: 'stale', days: Math.floor(age / DAY_MS) });
  }
  return reasons;
}

/**
 * What a revealed card says: "Bot, No commit for 34 d". A draft says nothing: the card's own
 * "Draft" chip already does, and printing it twice would only add noise.
 */
export function describeHiddenReasons(reasons: HiddenReason[]): string {
  return reasons
    .flatMap((reason) =>
      reason.kind === 'bot'
        ? ['Bot']
        : reason.kind === 'stale'
          ? [`No commit for ${reason.days} d`]
          : [],
    )
    .join(', ');
}
