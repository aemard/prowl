/**
 * Why a pull request can or cannot be merged, in plain words: one line per blocker
 * ("Blocked: 1 approval required", "Conflicts with main"), or "Ready to merge". Pure and
 * table-tested; `PullRequestDetails` only picks an icon per tone. Works from the list's data
 * alone and sharpens (which checks are required, how many approvals) once the detail is loaded.
 */

import { countMessage, t } from '../../lib/i18n';
import { isReadyToMerge } from '../../lib/mergeEligibility';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import type { Tone } from './ui/cx';

export interface MergeLine {
  tone: Tone;
  text: string;
  link?: string;
}

function reviewLine(pr: PullRequest, detail: PullRequestDetail | undefined): MergeLine | null {
  if (pr.reviewDecision === 'changes_requested') {
    const by = pr.reviews.filter(({ state }) => state === 'changes_requested');
    return {
      tone: 'danger',
      text:
        by.length > 0
          ? t('changesRequestedBy', by.map((r) => r.author).join(', '))
          : t('changesRequested2'),
    };
  }
  if (pr.reviewDecision !== 'review_required') return null;
  const approvals = pr.reviews.filter(({ state }) => state === 'approved').length;
  const missing =
    detail?.requiredApprovals &&
    !pr.incomplete?.includes('reviews') &&
    !detail.warnings?.some(
      (warning) => warning.includes('reviews') || warning === t('reviewsNotLoaded'),
    )
      ? Math.max(detail.requiredApprovals - approvals, 1)
      : 0;
  return {
    tone: 'attention',
    text:
      missing > 0
        ? countMessage(missing, 'approvalNeeded', 'approvalsNeeded')
        : t('reviewRequired'),
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
      required > 0 && (listed || pr.mergeStateStatus !== 'unstable')
        ? {
            tone: 'danger',
            text: listed
              ? countMessage(required, 'requiredCheckFailed', 'requiredChecksFailed')
              : countMessage(required, 'checkFailed', 'checksFailed'),
          }
        : {
            tone: 'neutral',
            text: countMessage(failed, 'optionalCheckFailed', 'optionalChecksFailed'),
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
      text: listed
        ? countMessage(waiting, 'requiredCheckRunning', 'requiredChecksRunning')
        : countMessage(waiting, 'checkRunning', 'checksRunning2'),
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
    return [{ tone: 'done', text: pr.closedBy ? t('mergedBy', pr.closedBy) : t('merged') }];
  }
  if (pr.state === 'closed') {
    return [{ tone: 'neutral', text: t('closedWithoutMerging') }];
  }
  const lines: MergeLine[] = [];
  if (pr.isDraft) lines.push({ tone: 'attention', text: t('draft') });
  const review = reviewLine(pr, detail);
  if (review) lines.push(review);
  if (pr.mergeable === 'conflicting') {
    lines.push({
      tone: 'warning',
      text: t('conflictsWith', pr.baseRefName),
      link: t('resolveOnGitHub'),
    });
  }
  if (pr.mergeStateStatus === 'behind') {
    lines.push({ tone: 'warning', text: t('behind', pr.baseRefName) });
  }
  lines.push(...checkLines(pr, detail));
  if (detail?.requiresConversationResolution && pr.unresolvedThreads > 0) {
    lines.push({
      tone: 'attention',
      text: countMessage(pr.unresolvedThreads, 'conversationToResolve', 'conversationsToResolve'),
    });
  }
  const unknown =
    pr.mergeable === 'unknown' ||
    pr.mergeStateStatus === 'unknown' ||
    pr.reviewDecision === 'unknown';
  if (unknown) {
    lines.push({
      tone: 'attention',
      text: refreshed ? t('mergeStatusUnknown') : t('checkingMergeStatus'),
      ...(refreshed ? { link: t('openOnGitHub') } : {}),
    });
  } else if (isReadyToMerge(pr) && lines.every(({ tone }) => tone === 'neutral')) {
    lines.unshift({ tone: 'success', text: t('readyToMerge2') });
  } else if (lines.every(({ tone }) => tone === 'neutral')) {
    lines.push({ tone: 'attention', text: t('blockedByBranchRules'), link: t('detailsOnGitHub') });
  }
  if (pr.autoMerge) lines.unshift({ tone: 'neutral', text: t('autoMergeOnMergesWhenReady') });
  return lines;
}

/** Where a merge control sits: before the review actions (merge), after them (auto), or both. */
export type MergePlacement = 'merge' | 'auto' | 'all';

/**
 * What the merge control may offer, so it never contradicts the blockers listed above it: Merge
 * when GitHub's verdict is ready; "Merge without waiting" when it is not but the viewer can bypass
 * the rules (`viewerCanMergeAsAdmin`); otherwise auto-merge when the repository and the viewer
 * allow it, or nothing. On a branch with a merge queue (`queue`), Merge is "Add to merge queue",
 * offered only when ready (the queue is no way around the rules), and auto-merge is GitHub's
 * "Merge when ready", which queues the PR once its requirements pass. Unverified merge facts
 * offer nothing until a refresh fills them in. GitHub still has the last word; a refusal shows
 * its reason in a toast and requests a refresh.
 */
export function mergeOptions(pr: PullRequest, placement: MergePlacement = 'all', queue = false) {
  const ready = isReadyToMerge(pr);
  const known =
    pr.mergeable !== 'unknown' &&
    pr.mergeStateStatus !== 'unknown' &&
    pr.reviewDecision !== 'unknown';
  const bypass = !queue && pr.viewerCanMergeAsAdmin === true;
  return {
    ready,
    canMerge: placement !== 'auto' && known && (ready || bypass),
    offerAutoMerge:
      placement !== 'merge' &&
      known &&
      !ready &&
      pr.autoMergeAllowed &&
      !pr.autoMerge &&
      pr.viewerCanEnableAutoMerge === true,
  };
}
