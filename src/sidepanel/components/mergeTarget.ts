/**
 * The one model behind every merge control: what merges (a lone pull request, or a stack's ready
 * run up to its top), what may be offered (`mergeVerbs`, the readiness rules) and how each offer
 * is sent to GitHub (`sendMerge`). `MergeAction` (the card), `StackItem` (the list) and the one
 * `MergeDialog` all read it, so a rule lives here once.
 */
import type { GitHubClient } from '../../lib/github/client';
import { enqueuePullRequest, mergePullRequest, setAutoMerge } from '../../lib/github/mergeActions';
import { mergeStackUpTo } from '../../lib/github/stackMerge';
import { countMessage, type MessageKey, t } from '../../lib/i18n';
import { isReadyToMerge } from '../../lib/mergeEligibility';
import type { MergeMethod, PullRequest, PullRequestDetail } from '../../lib/model';

export interface MergeTarget {
  /** The pull request GitHub is asked to merge: the lone one, or the top of a stack's ready run. */
  pr: PullRequest;
  /** For a stack: its ready run bottom to top (ending with `pr`), and how many of it are open. */
  stack?: { members: PullRequest[]; open: number };
}

/** Merge now, turn on auto-merge ("Merge when ready" on a queue branch), or add to the queue. */
export type MergeVerb = 'merge' | 'auto' | 'enqueue';

/** Where a merge control sits: before the review actions (merge), after them (auto), or both. */
export type MergePlacement = 'merge' | 'auto' | 'all';

/** Whether GitHub's merge facts of `pr` are verified; unverified, nothing is offered. */
const known = (pr: PullRequest) =>
  pr.mergeable !== 'unknown' &&
  pr.mergeStateStatus !== 'unknown' &&
  pr.reviewDecision !== 'unknown';

/**
 * What a lone PR's control may offer, so it never contradicts the blockers listed above it:
 * Merge when GitHub's verdict is ready, or ("Merge without waiting") when the viewer can bypass
 * the rules (`viewerCanMergeAsAdmin`); auto-merge while it is not ready, when the repository and
 * the viewer allow it. On a merge-queue branch (`queue`) Merge is "Add to merge queue", only when
 * ready (the queue is no way around the rules), and auto-merge is GitHub's "Merge when ready".
 * GitHub still has the last word: a refusal shows its reason in the dialog.
 */
export function mergeVerbs(pr: PullRequest, placement: MergePlacement, queue: boolean) {
  const ready = isReadyToMerge(pr);
  const verbs: MergeVerb[] = [];
  if (!known(pr)) return verbs;
  const autoMerge = pr.autoMergeAllowed && !pr.autoMerge && pr.viewerCanEnableAutoMerge === true;
  if (placement !== 'merge' && !ready && autoMerge) verbs.push('auto');
  if (placement !== 'auto' && (ready || (!queue && pr.viewerCanMergeAsAdmin === true)))
    verbs.push(queue ? 'enqueue' : 'merge');
  return verbs;
}

/**
 * The method a merge goes with: the first of `preferred` that `methods` allows (the user's pick,
 * then the repository's default), else the first allowed one. `methods` are the detail's, which
 * the base branch's rules narrowed (`PullRequestDetail.allowedMergeMethods`), where known.
 */
export const pickMethod = (methods: MergeMethod[], ...preferred: (MergeMethod | undefined)[]) =>
  [...preferred, ...methods].find((m): m is MergeMethod => m !== undefined && methods.includes(m));

/**
 * What the target's detail (`undefined` until read) lets it offer at `placement`, with the
 * user's `picked` method: through the queue or not, the allowed methods and the one it merges
 * with, the verbs, and what each is called (the button, the pending action).
 */
export function mergePlan(
  { pr, stack }: MergeTarget,
  detail: PullRequestDetail | undefined,
  placement: MergePlacement = 'all',
  picked?: MergeMethod,
) {
  const queue = detail?.mergeQueue !== undefined;
  const methods = detail?.allowedMergeMethods ?? pr.allowedMergeMethods;
  const method = pickMethod(methods, picked, pr.defaultMergeMethod);
  // The stack's run is ready by construction (`stackSummary`).
  const offered: MergeVerb[] = stack
    ? [queue ? 'enqueue' : 'merge']
    : mergeVerbs(pr, placement, queue);
  // Every verb but the queue's own needs a method the rules allow.
  const verbs = detail ? offered.filter((verb) => method || verb === 'enqueue') : [];
  const stackTitle =
    stack &&
    (queue
      ? countMessage(stack.members.length, 'stackQueueOne', 'stackQueueOther')
      : countMessage(stack.members.length, 'stackMergeOne', 'stackMergeOther'));
  const name = (verb: MergeVerb) =>
    stackTitle || (verb === 'auto' && queue ? t('mergeWhenReady') : t(VERB_NAMES[verb]));
  return { queue, methods, method, verbs, name, stackTitle };
}

export type MergePlan = ReturnType<typeof mergePlan>;

const VERB_NAMES: Record<MergeVerb, MessageKey> = {
  merge: 'merge',
  auto: 'enableAutoMerge',
  enqueue: 'addToMergeQueue',
};

/** What the toast says GitHub did with a stack. */
const STACK_OUTCOMES = {
  merged: 'stackMerged',
  enqueued: 'addedToMergeQueue',
  pending: 'stackStillMerging',
} as const;

/**
 * Sends `verb` for `target`, pinned to the head the user saw, and resolves to the toast's verb.
 * A stack merges through GitHub's asynchronous merge API (the GraphQL mutations refuse stacked
 * PRs); `title` is the commit title the user wrote, GitHub's own when undefined.
 */
export async function sendMerge(
  client: GitHubClient,
  { pr, stack }: MergeTarget,
  verb: MergeVerb,
  method: MergeMethod,
  title?: string,
): Promise<string> {
  if (stack) {
    const queue = verb === 'enqueue';
    return t(STACK_OUTCOMES[await mergeStackUpTo(client, pr, { method, queue })]);
  }
  if (verb === 'merge') {
    await mergePullRequest(client, pr.id, { method, headSha: pr.headSha, title });
    return t('merged');
  }
  if (verb === 'auto') {
    await setAutoMerge(client, pr.id, method, pr.headSha, title);
    return t('autoMergeIsOnFor');
  }
  await enqueuePullRequest(client, pr.id, pr.headSha);
  return t('addedToMergeQueue');
}
