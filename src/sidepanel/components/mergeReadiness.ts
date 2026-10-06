/**
 * Why a pull request can or cannot be merged, in plain words: one line per blocker
 * ("Blocked: 1 approval required", "Conflicts with main"), or "Ready to merge". Pure and
 * table-tested; `PullRequestDetails` only picks an icon per tone. Works from the list's data
 * alone and sharpens (which checks are required, how many approvals) once the detail is loaded.
 */
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import type { Tone } from './ui/cx';

export interface MergeLine {
  tone: Tone;
  text: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function reviewLine(pr: PullRequest, detail: PullRequestDetail | undefined): MergeLine | null {
  if (pr.reviewDecision === 'changes_requested') {
    const by = pr.reviews.filter(({ state }) => state === 'changes_requested');
    return {
      tone: 'danger',
      text: `Blocked: changes requested${by.length > 0 ? ` by ${by.map((r) => r.author).join(', ')}` : ''}`,
    };
  }
  if (pr.reviewDecision !== 'review_required') return null;
  const approvals = pr.reviews.filter(({ state }) => state === 'approved').length;
  const missing = detail?.requiredApprovals ? Math.max(detail.requiredApprovals - approvals, 1) : 0;
  return {
    tone: 'attention',
    text:
      missing > 0
        ? `Blocked: ${missing} ${approvals > 0 ? 'more ' : ''}${missing === 1 ? 'approval' : 'approvals'} required`
        : 'Blocked: review required',
  };
}

function checkLines(pr: PullRequest, detail: PullRequestDetail | undefined): MergeLine[] {
  // No checks in the detail although the PR has some: the token could not read them.
  const listed = detail?.checks.length ? detail.checks : undefined;
  const lines: MergeLine[] = [];
  const { failed, pending } = pr.checks;
  if (failed > 0) {
    const required = listed
      ? listed.filter((check) => check.required && check.state === 'failed').length
      : pr.mergeStateStatus === 'unstable'
        ? 0
        : failed;
    lines.push(
      required > 0
        ? {
            tone: 'danger',
            text: `Blocked: ${plural(required, listed ? 'required check' : 'check')} failing`,
          }
        : { tone: 'neutral', text: `${plural(failed, 'check')} failing, but not required` },
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
      text: `Waiting for ${plural(waiting, listed ? 'required check' : 'check')} to finish`,
    });
  }
  return lines;
}

/** At least one line. A `neutral` line informs; any other tone is a blocker or the verdict. */
export function mergeReadiness(pr: PullRequest, detail?: PullRequestDetail): MergeLine[] {
  if (pr.state === 'merged') {
    return [{ tone: 'done', text: pr.closedBy ? `Merged by ${pr.closedBy}` : 'Merged' }];
  }
  if (pr.state === 'closed') {
    return [{ tone: 'neutral', text: 'Closed without merging' }];
  }
  const lines: MergeLine[] = [];
  if (pr.isDraft) {
    lines.push({ tone: 'attention', text: 'Blocked: draft, mark it ready for review to merge' });
  } else {
    const review = reviewLine(pr, detail);
    if (review) lines.push(review);
  }
  if (pr.mergeable === 'conflicting') {
    lines.push({ tone: 'warning', text: `Conflicts with ${pr.baseRefName}` });
  }
  if (pr.mergeStateStatus === 'behind') {
    lines.push({ tone: 'warning', text: `Blocked: branch is behind ${pr.baseRefName}` });
  }
  lines.push(...checkLines(pr, detail));
  if (detail?.requiresConversationResolution && pr.unresolvedThreads > 0) {
    lines.push({
      tone: 'attention',
      text: `Blocked: ${plural(pr.unresolvedThreads, 'conversation')} to resolve`,
    });
  }
  if (lines.every(({ tone }) => tone === 'neutral')) {
    if (pr.mergeable === 'unknown' || pr.mergeStateStatus === 'unknown') {
      lines.push({ tone: 'neutral', text: 'GitHub is still checking whether it can be merged' });
    } else if (pr.mergeStateStatus === 'blocked') {
      lines.push({ tone: 'attention', text: "Blocked by the base branch's rules" });
    } else {
      lines.push({ tone: 'success', text: 'Ready to merge' });
    }
  }
  return lines;
}
