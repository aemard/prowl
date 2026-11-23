/**
 * What a pull request card says about a PR, as plain data: the status chips (draft, CI, review,
 * merge) and the sentence a screen reader gets for the whole card. Pure, so it is table-tested;
 * `PullRequestCard` only picks an icon per `StatusIcon` and renders.
 */

import { countMessage, t } from '../../lib/i18n';
import { failingChecksBlock, isReadyToMerge } from '../../lib/mergeEligibility';
import type { CheckSummary, MergeMethod, PullRequest, Turn } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import { TURN_LABELS } from '../../lib/turn/whoseTurn';
import type { Tone } from './ui/cx';

export type StatusIcon =
  | 'draft'
  | 'check'
  | 'x'
  | 'dot'
  | 'diff'
  | 'eye'
  | 'alert'
  | 'merge'
  | 'bell';

export interface Status {
  id: 'turn' | 'draft' | 'ci' | 'review' | 'merge';
  tone: Tone;
  icon: StatusIcon;
  /** Short chip text. */
  label: string;
  /** Full sentence for the tooltip and the card's accessible name. */
  detail: string;
}

/** How GitHub names each merge method in its merge box. */
export const MERGE_METHOD_NAMES: Record<MergeMethod, string> = {
  get merge() {
    return t('mergeCommit');
  },
  get squash() {
    return t('squashMethod');
  },
  get rebase() {
    return t('rebaseMethod');
  },
};

/**
 * CI rollup chip, or null when the commit has no checks. A failure that does not `block` (only
 * optional checks fail, `failingChecksBlock`) is neutral, not red.
 */
export function ciStatus(checks: CheckSummary, block = true): Status | null {
  const { failed, pending, passed, neutral, total } = checks;
  const counts = [
    failed && countMessage(failed, 'failed2One', 'failed2'),
    pending && countMessage(pending, 'pending2One', 'pending2'),
    passed && countMessage(passed, 'passed2One', 'passed2'),
    neutral && countMessage(neutral, 'skipped2One', 'skipped2'),
  ]
    .filter(Boolean)
    .join(', ');
  const of = `${counts} (${countMessage(total, 'checkCountOne', 'checkCountOther')})`;
  switch (checks.state) {
    case 'failure':
      return {
        id: 'ci',
        tone: block ? 'danger' : 'neutral',
        icon: 'x',
        label: countMessage(failed, 'failingOne', 'failing'),
        detail: t(block ? 'checksFailing' : 'checksFailingOptional', of),
      };
    case 'pending':
      return {
        id: 'ci',
        tone: 'attention',
        icon: 'dot',
        label: countMessage(pending, 'pending2One', 'pending2'),
        detail: t('checksRunning', of),
      };
    case 'success':
      return {
        id: 'ci',
        tone: 'success',
        icon: 'check',
        label: passed > 0 ? countMessage(passed, 'passed2One', 'passed2') : t('passed'),
        detail: t('checksPassed', of),
      };
    default:
      return null;
  }
}

function reviewStatus(pr: PullRequest): Status | null {
  switch (pr.reviewDecision) {
    case 'approved':
      return {
        id: 'review',
        tone: 'success',
        icon: 'check',
        label: t('approved2'),
        detail: t('approved2'),
      };
    case 'changes_requested':
      return {
        id: 'review',
        tone: 'danger',
        icon: 'diff',
        label: t('changesRequested2'),
        detail: t('changesRequested2'),
      };
    case 'review_required':
      // Nobody is expected to review a draft yet.
      return pr.isDraft
        ? null
        : {
            id: 'review',
            tone: 'attention',
            icon: 'eye',
            label: t('awaitingReview'),
            detail: t('reviewRequired'),
          };
    default:
      return null;
  }
}

/** The chip each reason of the viewer's turn takes over: one chip per fact. */
const TURN_CHIP: Partial<Record<Turn['reason'], Status['id']>> = {
  ci_failed: 'ci',
  changes_requested: 'review',
  review_requested: 'review',
  re_review: 'review',
  conflicts: 'merge',
  ready_to_merge: 'merge',
};

/**
 * When it is the viewer's move, the chip stating that fact becomes the action: same color, a
 * bell, words saying what to do ("Fix CI · 1 failing", "Review", "Merge it"). A reason with no
 * chip of its own (feedback to answer, a review asked with no decision yet) adds one up front.
 */
function withTurn(chips: Status[], turn: Turn | undefined, now: number): Status[] {
  const key = turn?.owner === 'you' ? TURN_LABELS[turn.reason] : undefined;
  if (!turn || !key) return chips;
  const action = t(key);
  const detail = t('yourTurnSince', action, formatRelativeTime(turn.since, now));
  const target = TURN_CHIP[turn.reason];
  const index = chips.findIndex((chip) => chip.id === target);
  const fact = chips[index];
  if (!fact) return [{ id: 'turn', tone: 'accent', icon: 'bell', label: action, detail }, ...chips];
  const merged: Status = {
    ...fact,
    // Someone else's review state is neutral news; asked of you, it is your action.
    tone: fact.tone === 'attention' ? 'accent' : fact.tone,
    icon: 'bell',
    label: turn.reason === 'ci_failed' ? `${action} · ${fact.label}` : action,
    detail: t('turnChipDetail', detail, fact.detail),
  };
  return chips.map((chip, i) => (i === index ? merged : chip));
}

const mergeChip = (label: string, detail: string, tone: Tone = 'accent'): Status => ({
  id: 'merge',
  tone,
  icon: 'merge',
  label,
  detail,
});

/** Conflicts, who merges it (the merge queue, auto-merge), or ready to merge; else nothing. */
function mergeStatus(pr: PullRequest, ready: boolean): Status | null {
  if (pr.mergeable === 'conflicting')
    return { ...mergeChip(t('conflicts'), t('hasMergeConflicts'), 'warning'), icon: 'alert' };
  if (pr.state !== 'open') return null;
  if (pr.inMergeQueue) return mergeChip(t('inMergeQueueShort'), t('inMergeQueueShort'));
  if (pr.autoMerge) {
    const method = MERGE_METHOD_NAMES[pr.autoMerge.method];
    const by = pr.autoMerge.enabledBy;
    return mergeChip(
      t('autoMerge'),
      by ? t('autoMergeBy', method, by) : t('autoMergeMethod', method),
    );
  }
  if (!ready) return null;
  // Ready, but not the viewer's to merge (`waiting_on_merge`): the chip says who merges it.
  const detail = pr.viewerCanMerge ? t('readyToMerge2') : t('readyAwaitsMaintainer');
  return mergeChip(t('readyToMerge2'), detail, 'success');
}

/** Chips in reading order: Draft, CI, review, then the merge chip; see `withTurn`. */
export function pullRequestStatuses(pr: PullRequest, turn?: Turn, now = Date.now()): Status[] {
  const ready = isReadyToMerge(pr);
  const chips: (Status | null)[] = [
    pr.isDraft
      ? { id: 'draft', tone: 'neutral', icon: 'draft', label: t('draft'), detail: t('draft') }
      : null,
    ciStatus(pr.checks, failingChecksBlock(pr)),
    // "Ready to merge" already says approved.
    ready && pr.reviewDecision === 'approved' ? null : reviewStatus(pr),
    mergeStatus(pr, ready),
  ];
  return withTurn(
    chips.filter((chip): chip is Status => chip !== null),
    turn,
    now,
  );
}

/** One sentence per fact, for the card's accessible description (its name is the title). */
export function describePullRequest(
  pr: PullRequest,
  statuses: Status[],
  unseen: boolean,
  now: number,
): string {
  const by = pr.author ? t('authorBy', pr.author.login) : '';
  const facts = [
    ...statuses.map((status) => status.detail),
    pr.unresolvedThreads > 0 &&
      countMessage(pr.unresolvedThreads, 'unresolvedCountOne', 'unresolvedCountOther'),
    pr.commentCount > 0 && countMessage(pr.commentCount, 'commentCountOne', 'commentCountOther'),
    pr.labels.length > 0 && t('labels', pr.labels.map((label) => label.name).join(', ')),
    t('updated2', formatRelativeTime(pr.updatedAt, now)),
    t('opened', formatRelativeTime(pr.createdAt, now)),
    unseen && t('unseenChanges'),
  ].filter(Boolean);
  return `${pr.repo.nameWithOwner}#${pr.number}${by}. ${facts.join('. ')}`;
}
