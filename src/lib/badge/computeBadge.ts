/**
 * What the toolbar icon shows: a count of the pull requests that need you (or that changed
 * since you last looked), whether one of them is red, and a tooltip saying why. Pure: the
 * service worker (`src/background/badge.ts`) paints the result.
 */
import { activityKey } from '../activity';
import { isReadyToMerge } from '../diff/diffSnapshots';
import { countMessage, formatNumber, type MessageKey, t } from '../i18n';
import type { BadgeMode, PrLocalState, PullRequest, Snapshot, TurnReason } from '../model';
import { isSeen, isSnoozed } from '../storage/prLocal';
import { turnIn } from '../turn/whoseTurn';

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
const REASONS: { label: MessageKey; red: boolean; applies: (pr: PullRequest) => boolean }[] = [
  { label: 'ciFailing', red: true, applies: (pr) => pr.checks.state === 'failure' },
  {
    label: 'changesRequested',
    red: true,
    applies: (pr) => pr.reviewDecision === 'changes_requested',
  },
  { label: 'conflictsLower', red: false, applies: (pr) => pr.mergeable === 'conflicting' },
  { label: 'readyToMerge', red: false, applies: isReadyToMerge },
];

/** A cleared badge: no text, the plain tooltip. */
export const NO_BADGE: BadgeView = { text: '', title: BADGE_TITLE, danger: false };

const reasonsOf = (pr: PullRequest) =>
  pr.state === 'open' ? REASONS.filter((reason) => reason.applies(pr)) : [];

const RED_TURNS: ReadonlySet<TurnReason> = new Set(['ci_failed', 'changes_requested']);

/**
 * How the tooltip counts each reason it is the viewer's move, in this order: noun phrases with
 * their plural ("2 reviews requested, 1 with failing CI"), not the cards' imperative chip labels.
 */
const TURN_COUNTS: [TurnReason, MessageKey, MessageKey][] = [
  ['review_requested', 'badgeReviewRequestedOne', 'badgeReviewRequestedOther'],
  ['re_review', 'badgeReReviewOne', 'badgeReReviewOther'],
  ['ci_failed', 'badgeCiFailedOne', 'badgeCiFailedOther'],
  ['changes_requested', 'badgeChangesRequestedOne', 'badgeChangesRequestedOther'],
  ['conflicts', 'badgeConflictsOne', 'badgeConflictsOther'],
  ['feedback', 'badgeFeedbackOne', 'badgeFeedbackOther'],
  ['ready_to_merge', 'badgeReadyToMergeOne', 'badgeReadyToMergeOther'],
];

/** `turn`: the PRs where it is the viewer's move, and why, from the same rule as the list. */
function turnBadge(snapshot: Snapshot, prs: PullRequest[]): BadgeView {
  const reasons = prs
    .map((pr) => turnIn(snapshot, pr))
    .flatMap((turn) => (turn.owner === 'you' ? [turn.reason] : []));
  if (reasons.length === 0) return NO_BADGE;
  const why = TURN_COUNTS.map(([reason, one, other]) => ({
    one,
    other,
    n: reasons.filter((r) => r === reason).length,
  }))
    .filter(({ n }) => n > 0)
    .map(({ one, other, n }) => countMessage(n, one, other));
  const pulls = countMessage(reasons.length, 'pullCountOne', 'pullCountOther');
  return {
    text: reasons.length > MAX_SHOWN ? `${MAX_SHOWN}+` : String(reasons.length),
    title: t('waitingOnYou', BADGE_TITLE, pulls, why.join(', ')),
    danger: reasons.some((reason) => RED_TURNS.has(reason)),
  };
}

/**
 * The badge for `snapshot` under `mode`. Only PRs in a section count, never a snoozed one; a
 * muted one does: mute only silences notifications. `turn` counts PRs where it is the viewer's
 * move (`whoseTurn`); `attention` counts open PRs with failing CI, requested changes, conflicts
 * or ready to merge; `unseen` counts PRs updated since the user saw them. No snapshot (signed
 * out) and `off` show nothing.
 */
export function computeBadge(
  snapshot: Snapshot | undefined,
  local: PrLocalState,
  mode: BadgeMode,
  now: number,
): BadgeView {
  if (!snapshot || mode === 'off') return NO_BADGE;
  const ids = new Set(Object.values(snapshot.sections).flat());
  const awake = [...ids]
    .flatMap((id) => snapshot.pullRequests[id] ?? [])
    .filter((pr) => !isSnoozed(local, pr.id, now));
  if (mode === 'turn') return turnBadge(snapshot, awake);
  const counted = awake.filter((pr) =>
    mode === 'attention'
      ? reasonsOf(pr).length > 0
      : !isSeen(local, pr.id, pr.updatedAt, activityKey(pr)),
  );
  if (counted.length === 0) return NO_BADGE;

  const count = counted.length;
  const pulls = countMessage(count, 'pullCountOne', 'pullCountOther');
  const why = REASONS.map((reason) => ({
    label: t(reason.label),
    n: counted.filter((pr) => reasonsOf(pr).includes(reason)).length,
  }))
    .filter(({ n }) => n > 0)
    .map(({ label, n }) => `${formatNumber(n)} ${label}`);
  return {
    text: count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count),
    title:
      mode === 'unseen'
        ? t('withUnseenChanges', BADGE_TITLE, pulls)
        : t('needingAttention', BADGE_TITLE, pulls, why.join(', ')),
    danger: counted.some((pr) => reasonsOf(pr).some((reason) => reason.red)),
  };
}
