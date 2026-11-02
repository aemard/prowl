/**
 * What a pull request card says about a PR, as plain data: the status chips (draft, CI, review,
 * merge) and the sentence a screen reader gets for the whole card. Pure, so it is table-tested;
 * `PullRequestCard` only picks an icon per `StatusIcon` and renders.
 */
import { isReadyToMerge } from '../../lib/diff/diffSnapshots';
import { countMessage, t } from '../../lib/i18n';
import type { CheckSummary, MergeMethod, PullRequest } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import type { Tone } from './ui/cx';

export type StatusIcon = 'draft' | 'check' | 'x' | 'dot' | 'diff' | 'eye' | 'alert' | 'merge';

export interface Status {
  id: 'draft' | 'ci' | 'review' | 'merge';
  tone: Tone;
  icon: StatusIcon;
  /** Short chip text. */
  label: string;
  /** Full sentence for the tooltip and the card's accessible name. */
  detail: string;
}

/** How GitHub names each merge method in its merge box. */
export const MERGE_METHOD_NAMES: Record<MergeMethod, string> = {
  merge: t('mergeCommit'),
  squash: t('squashMethod'),
  rebase: t('rebaseMethod'),
};

/** CI rollup chip, or null when the commit has no checks. */
export function ciStatus(checks: CheckSummary): Status | null {
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
        tone: 'danger',
        icon: 'x',
        label: countMessage(failed, 'failingOne', 'failing'),
        detail: t('checksFailing', of),
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
            label: t('reviewRequired'),
            detail: t('reviewRequired'),
          };
    default:
      return null;
  }
}

/** Chips in reading order: Draft, CI, review, then conflicts or ready to merge. */
export function pullRequestStatuses(pr: PullRequest): Status[] {
  const ready = isReadyToMerge(pr);
  const chips: (Status | null)[] = [
    pr.isDraft
      ? { id: 'draft', tone: 'neutral', icon: 'draft', label: t('draft'), detail: t('draft') }
      : null,
    ciStatus(pr.checks),
    // "Ready to merge" already says approved.
    ready && pr.reviewDecision === 'approved' ? null : reviewStatus(pr),
    pr.mergeable === 'conflicting'
      ? {
          id: 'merge',
          tone: 'warning',
          icon: 'alert',
          label: t('conflicts'),
          detail: t('hasMergeConflicts'),
        }
      : pr.autoMerge && pr.state === 'open'
        ? {
            id: 'merge',
            tone: 'accent',
            icon: 'merge',
            label: t('autoMerge'),
            detail: pr.autoMerge.enabledBy
              ? t('autoMergeBy', MERGE_METHOD_NAMES[pr.autoMerge.method], pr.autoMerge.enabledBy)
              : t('autoMergeMethod', MERGE_METHOD_NAMES[pr.autoMerge.method]),
          }
        : ready
          ? {
              id: 'merge',
              tone: 'success',
              icon: 'merge',
              label: t('readyToMerge2'),
              detail: t('readyToMerge2'),
            }
          : null,
  ];
  return chips.filter((chip): chip is Status => chip !== null);
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
