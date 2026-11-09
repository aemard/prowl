/**
 * Why a pull request can or cannot be merged, in plain words: one line per blocker
 * ("Blocked: 1 approval required", "Conflicts with main"), or "Ready to merge". Pure and
 * table-tested; `PullRequestDetails` only picks an icon per tone. Works from the list's data
 * alone and sharpens (which checks are required, how many approvals) once the detail is loaded.
 */
import { isReadyToMerge } from '../../lib/diff/diffSnapshots';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import type { Tone } from './ui/cx';

export interface MergeLine {
  tone: Tone;
  text: string;
  link?: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function reviewLine(pr: PullRequest, detail: PullRequestDetail | undefined): MergeLine | null {
  if (pr.reviewDecision === 'changes_requested') {
    const by = pr.reviews.filter(({ state }) => state === 'changes_requested');
    return {
      tone: 'danger',
      text: `Changes requested${by.length > 0 ? ` by ${by.map((r) => r.author).join(', ')}` : ''}`,
    };
  }
  if (pr.reviewDecision !== 'review_required') return null;
  const approvals = pr.reviews.filter(({ state }) => state === 'approved').length;
  const missing =
    detail?.requiredApprovals &&
    !pr.incomplete?.includes('reviews') &&
    !detail.warnings?.some((warning) => warning.includes('reviews'))
      ? Math.max(detail.requiredApprovals - approvals, 1)
      : 0;
  return {
    tone: 'attention',
    text:
      missing > 0
        ? `${missing} ${missing === 1 ? 'approval' : 'approvals'} needed`
        : 'Review required',
  };
}

function checkLines(pr: PullRequest, detail: PullRequestDetail | undefined): MergeLine[] {
  // No checks in the detail although the PR has some: the token could not read them.
  const listed =
    detail?.checks.length &&
    detail.checks.length >= detail.checksTotal &&
    detail.checks.every((check) => check.required !== null)
      ? detail.checks
      : undefined;
  const lines: MergeLine[] = [];
  const { failed, pending } = pr.checks;
  if (failed > 0) {
    const required = listed
      ? listed.filter((check) => check.required && check.state === 'failed').length
      : failed;
    lines.push(
      required > 0
        ? {
            tone: !listed && pr.mergeStateStatus === 'unstable' ? 'neutral' : 'danger',
            text: `${plural(required, listed ? 'required check' : 'check')} failed`,
          }
        : { tone: 'neutral', text: `${plural(failed, 'optional check')} failed` },
    );
  }
  const waiting = listed
    ? listed.filter((check) => check.required && check.state === 'pending').length
    : pr.mergeStateStatus === 'blocked'
      ? pending
      : 0;
  if (waiting > 0) {
    lines.push({
      tone: 'attention',
      text: `${plural(waiting, listed ? 'required check' : 'check')} running`,
    });
  }
  return lines;
}

/** At least one line. A `neutral` line informs; any other tone is a blocker or the verdict. */
export function mergeReadiness(
  pr: PullRequest,
  detail?: PullRequestDetail,
  refreshed = false,
): MergeLine[] {
  if (pr.state === 'merged') {
    return [{ tone: 'done', text: pr.closedBy ? `Merged by ${pr.closedBy}` : 'Merged' }];
  }
  if (pr.state === 'closed') {
    return [{ tone: 'neutral', text: 'Closed without merging' }];
  }
  const lines: MergeLine[] = [];
  if (pr.isDraft) lines.push({ tone: 'attention', text: 'Draft' });
  const review = reviewLine(pr, detail);
  if (review) lines.push(review);
  if (pr.mergeable === 'conflicting') {
    lines.push({
      tone: 'warning',
      text: `Conflicts with ${pr.baseRefName}`,
      link: 'Resolve on GitHub',
    });
  }
  if (pr.mergeStateStatus === 'behind') {
    lines.push({ tone: 'warning', text: `Behind ${pr.baseRefName}` });
  }
  lines.push(...checkLines(pr, detail));
  if (detail?.requiresConversationResolution && pr.unresolvedThreads > 0) {
    lines.push({
      tone: 'attention',
      text: `${plural(pr.unresolvedThreads, 'conversation')} to resolve`,
    });
  }
  const unknown =
    pr.mergeable === 'unknown' ||
    pr.mergeStateStatus === 'unknown' ||
    pr.reviewDecision === 'unknown';
  if (unknown) {
    lines.push({
      tone: 'attention',
      text: refreshed ? 'Merge status unknown' : 'Checking merge status…',
      ...(refreshed ? { link: 'Open on GitHub' } : {}),
    });
  } else if (isReadyToMerge(pr) && lines.every(({ tone }) => tone === 'neutral')) {
    lines.unshift({ tone: 'success', text: 'Ready to merge' });
  } else if (lines.every(({ tone }) => tone === 'neutral')) {
    lines.push({ tone: 'attention', text: 'Blocked by branch rules', link: 'Details on GitHub' });
  }
  if (pr.autoMerge) lines.unshift({ tone: 'neutral', text: 'Auto-merge on, merges when ready' });
  return lines;
}
