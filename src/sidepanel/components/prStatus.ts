/**
 * What a pull request card says about a PR, as plain data: the status chips (draft, CI, review,
 * merge) and the sentence a screen reader gets for the whole card. Pure, so it is table-tested;
 * `PullRequestCard` only picks an icon per `StatusIcon` and renders.
 */
import { isReadyToMerge } from '../../lib/diff/diffSnapshots';
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
  merge: 'merge commit',
  squash: 'squash',
  rebase: 'rebase',
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** CI rollup chip, or null when the commit has no checks. */
export function ciStatus(checks: CheckSummary): Status | null {
  const { failed, pending, passed, neutral, total } = checks;
  const counts = [
    failed && `${failed} failed`,
    pending && `${pending} pending`,
    passed && `${passed} passed`,
    neutral && `${neutral} skipped`,
  ]
    .filter(Boolean)
    .join(', ');
  const of = `${counts} (${plural(total, 'check')})`;
  switch (checks.state) {
    case 'failure':
      return {
        id: 'ci',
        tone: 'danger',
        icon: 'x',
        label: `${failed} failing`,
        detail: `Checks failing: ${of}`,
      };
    case 'pending':
      return {
        id: 'ci',
        tone: 'attention',
        icon: 'dot',
        label: `${pending} pending`,
        detail: `Checks running: ${of}`,
      };
    case 'success':
      return {
        id: 'ci',
        tone: 'success',
        icon: 'check',
        label: passed > 0 ? `${passed} passed` : 'Passed',
        detail: `Checks passed: ${of}`,
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
        label: 'Approved',
        detail: 'Approved',
      };
    case 'changes_requested':
      return {
        id: 'review',
        tone: 'danger',
        icon: 'diff',
        label: 'Changes requested',
        detail: 'Changes requested',
      };
    case 'review_required':
      // Nobody is expected to review a draft yet.
      return pr.isDraft
        ? null
        : {
            id: 'review',
            tone: 'attention',
            icon: 'eye',
            label: 'Review required',
            detail: 'Review required',
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
      ? { id: 'draft', tone: 'neutral', icon: 'draft', label: 'Draft', detail: 'Draft' }
      : null,
    ciStatus(pr.checks),
    // "Ready to merge" already says approved.
    ready && pr.reviewDecision === 'approved' ? null : reviewStatus(pr),
    pr.mergeable === 'conflicting'
      ? {
          id: 'merge',
          tone: 'warning',
          icon: 'alert',
          label: 'Conflicts',
          detail: 'Has merge conflicts',
        }
      : pr.autoMerge && pr.state === 'open'
        ? {
            id: 'merge',
            tone: 'accent',
            icon: 'merge',
            label: 'Auto-merge',
            detail: `Auto-merge on (${MERGE_METHOD_NAMES[pr.autoMerge.method]})${
              pr.autoMerge.enabledBy ? `, by ${pr.autoMerge.enabledBy}` : ''
            }`,
          }
        : ready
          ? {
              id: 'merge',
              tone: 'success',
              icon: 'merge',
              label: 'Ready to merge',
              detail: 'Ready to merge',
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
  const by = pr.author ? `, by ${pr.author.login}` : '';
  const facts = [
    ...statuses.map((status) => status.detail),
    pr.unresolvedThreads > 0 && plural(pr.unresolvedThreads, 'unresolved thread'),
    pr.commentCount > 0 && plural(pr.commentCount, 'comment'),
    pr.labels.length > 0 && `Labels: ${pr.labels.map((label) => label.name).join(', ')}`,
    `Updated ${formatRelativeTime(pr.updatedAt, now)}`,
    `Opened ${formatRelativeTime(pr.createdAt, now)}`,
    unseen && 'Unseen changes',
  ].filter(Boolean);
  return `${pr.repo.nameWithOwner}#${pr.number}${by}. ${facts.join('. ')}`;
}
