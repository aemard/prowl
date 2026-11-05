import { countMessage, t } from '../../lib/i18n';
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

function reviewLine(pr: PullRequest, detail: PullRequestDetail | undefined): MergeLine | null {
  if (pr.reviewDecision === 'changes_requested') {
    const by = pr.reviews.filter(({ state }) => state === 'changes_requested');
    return {
      tone: 'danger',
      text:
        by.length > 0
          ? t('reviewChangesBy', by.map((r) => r.author).join(', '))
          : t('blockedChanges'),
    };
  }
  if (pr.reviewDecision !== 'review_required') return null;
  const approvals = pr.reviews.filter(({ state }) => state === 'approved').length;
  const missing = detail?.requiredApprovals ? Math.max(detail.requiredApprovals - approvals, 1) : 0;
  return {
    tone: 'attention',
    text:
      missing > 0
        ? approvals > 0
          ? countMessage(missing, 'blockedMoreApprovalOne', 'blockedMoreApprovalOther')
          : countMessage(missing, 'blockedApprovalOne', 'blockedApprovalOther')
        : t('blockedReviewRequired'),
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
            text: t(
              'blockedFailing',
              listed
                ? countMessage(required, 'requiredCheckCountOne', 'requiredCheckCountOther')
                : countMessage(required, 'checkCountOne', 'checkCountOther'),
            ),
          }
        : {
            tone: 'neutral',
            text: t(
              'failingButNotRequired',
              countMessage(failed, 'checkCountOne', 'checkCountOther'),
            ),
          },
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
      text: t(
        'waitingForToFinish',
        listed
          ? countMessage(waiting, 'requiredCheckCountOne', 'requiredCheckCountOther')
          : countMessage(waiting, 'checkCountOne', 'checkCountOther'),
      ),
    });
  }
  return lines;
}

/** At least one line. A `neutral` line informs; any other tone is a blocker or the verdict. */
export function mergeReadiness(pr: PullRequest, detail?: PullRequestDetail): MergeLine[] {
  if (pr.state === 'merged') {
    return [{ tone: 'done', text: pr.closedBy ? t('mergedBy', pr.closedBy) : t('merged') }];
  }
  if (pr.state === 'closed') {
    return [{ tone: 'neutral', text: t('closedWithoutMerging') }];
  }
  const lines: MergeLine[] = [];
  if (pr.isDraft) {
    lines.push({ tone: 'attention', text: t('blockedDraftMarkItReadyForReviewToMerge') });
  } else {
    const review = reviewLine(pr, detail);
    if (review) lines.push(review);
  }
  if (pr.mergeable === 'conflicting') {
    lines.push({ tone: 'warning', text: t('conflictsWith', pr.baseRefName) });
  }
  if (pr.mergeStateStatus === 'behind') {
    lines.push({ tone: 'warning', text: t('blockedBranchIsBehind', pr.baseRefName) });
  }
  lines.push(...checkLines(pr, detail));
  if (detail?.requiresConversationResolution && pr.unresolvedThreads > 0) {
    lines.push({
      tone: 'attention',
      text: countMessage(
        pr.unresolvedThreads,
        'blockedConversationOne',
        'blockedConversationOther',
      ),
    });
  }
  if (lines.every(({ tone }) => tone === 'neutral')) {
    if (pr.mergeable === 'unknown' || pr.mergeStateStatus === 'unknown') {
      lines.push({ tone: 'neutral', text: t('githubIsStillCheckingWhetherItCanBeMerged') });
    } else if (pr.mergeStateStatus === 'blocked') {
      lines.push({ tone: 'attention', text: t('blockedByTheBaseBranchSRules') });
    } else {
      lines.push({ tone: 'success', text: t('readyToMerge2') });
    }
  }
  return lines;
}
