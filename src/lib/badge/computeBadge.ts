/**
 * What the toolbar icon shows: a count of the pull requests that need you (or that changed
 * since you last looked), whether one of them is red, and a tooltip saying why. Pure: the
 * service worker (`src/background/badge.ts`) paints the result.
 */
import { isReadyToMerge } from '../diff/diffSnapshots';
import type { BadgeMode, PrLocalState, PullRequest, Snapshot } from '../model';
import { isSeen, isSnoozed } from '../storage/prLocal';

export interface BadgeView {
  /** Badge text: empty for none, `99+` above 99. */
  text: string;
  /** Tooltip of the toolbar icon. */
  title: string;
  /** A counted PR has failing CI or requested changes. */
  danger: boolean;
}

export const BADGE_TITLE = 'Prowl';
const MAX_SHOWN = 99;

/** Why an open PR needs attention, in the order the tooltip lists them. */
const REASONS: { label: string; red: boolean; applies: (pr: PullRequest) => boolean }[] = [
  { label: 'CI failing', red: true, applies: (pr) => pr.checks.state === 'failure' },
  {
    label: 'changes requested',
    red: true,
    applies: (pr) => pr.reviewDecision === 'changes_requested',
  },
  { label: 'conflicts', red: false, applies: (pr) => pr.mergeable === 'conflicting' },
  { label: 'ready to merge', red: false, applies: isReadyToMerge },
];

/** A cleared badge: no text, the plain tooltip. */
export const NO_BADGE: BadgeView = { text: '', title: BADGE_TITLE, danger: false };

const reasonsOf = (pr: PullRequest) =>
  pr.state === 'open' ? REASONS.filter((reason) => reason.applies(pr)) : [];

/**
 * The badge for `snapshot` under `mode`. Only PRs in a section count, never a snoozed one (a
 * muted one does: mute only silences notifications). `attention` counts open PRs with failing
 * CI, requested changes, conflicts or ready to merge; `unseen` counts PRs updated since the
 * user saw them. No snapshot (signed out) and `off` show nothing.
 */
export function computeBadge(
  snapshot: Snapshot | undefined,
  local: PrLocalState,
  mode: BadgeMode,
  now: number,
): BadgeView {
  if (!snapshot || mode === 'off') return NO_BADGE;
  const ids = new Set(Object.values(snapshot.sections).flat());
  const counted = [...ids]
    .flatMap((id) => snapshot.pullRequests[id] ?? [])
    .filter((pr) => !isSnoozed(local, pr.id, now))
    .filter((pr) =>
      mode === 'attention' ? reasonsOf(pr).length > 0 : !isSeen(local, pr.id, pr.updatedAt),
    );
  if (counted.length === 0) return NO_BADGE;

  const count = counted.length;
  const pulls = `${count} pull request${count === 1 ? '' : 's'}`;
  const why = REASONS.map((reason) => ({
    label: reason.label,
    n: counted.filter((pr) => reasonsOf(pr).includes(reason)).length,
  }))
    .filter(({ n }) => n > 0)
    .map(({ label, n }) => `${n} ${label}`);
  return {
    text: count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count),
    title:
      mode === 'unseen'
        ? `${BADGE_TITLE}: ${pulls} with unseen changes`
        : `${BADGE_TITLE}: ${pulls} needing attention (${why.join(', ')})`,
    danger: counted.some((pr) => reasonsOf(pr).some((reason) => reason.red)),
  };
}
