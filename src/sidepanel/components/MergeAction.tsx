import { useState } from 'preact/hooks';
import type { GitHubClient } from '../../lib/github/client';
import { dequeuePullRequest, setAutoMerge } from '../../lib/github/mergeActions';
import { formatNumber, t } from '../../lib/i18n';
import { isReadyToMerge } from '../../lib/mergeEligibility';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { stackMembers, stackSummary } from '../../lib/stacks';
import { mergeDetailOf } from '../state/loadDetail';
import { forPr, pendingActions, prRef, runPrAction } from '../state/prActions';
import { auth, snapshot } from '../state/store';
import { GitHubLink } from './GitHubLink';
import { GitMergeIcon } from './icons';
import { MergeDialog } from './MergeDialog';
import { type MergePlacement, type MergeTarget, mergePlan } from './mergeTarget';
import { Button, type ButtonProps } from './ui/Button';
import './MergeAction.css';

/**
 * Merging an open, non-draft PR the viewer can merge, in one of two places of the actions row:
 * Merge (or "Add to merge queue") before the review actions, auto-merge after them
 * (`placement`). Nothing shows until the card's detail says whether the base branch merges
 * through a merge queue, where a direct Merge is one GitHub refuses; when the detail cannot be
 * read, or the rules leave no method, a link to merge on GitHub stands in. A queued PR shows its
 * place instead. A stacked PR merges only with its stack ("Merge up to here").
 */
export function MergeAction({
  pr,
  placement = 'all',
}: {
  pr: PullRequest;
  placement?: MergePlacement;
}) {
  const { detail, failed } = mergeDetailOf(pr);
  if (!auth.value || !pr.viewerCanMerge || pr.state !== 'open' || pr.isDraft) return null;
  const link = placement !== 'auto' && <GitHubLink href={pr.url}>{t('mergeOnGitHub')}</GitHubLink>;
  const off = placement !== 'merge' && <TurnOffAutoMerge pr={pr} />;
  if (pr.stack)
    return (
      <>
        {placement !== 'auto' && <StackRoute pr={pr} />}
        {off}
      </>
    );
  if (!detail) return failed ? link : null;
  const { mergeQueue } = detail;
  // Off a queue, every offer needs a method the rules allow.
  const noMethod = mergeQueue === undefined && !mergePlan({ pr }, detail).method;
  return (
    <>
      {mergeQueue ? (
        placement !== 'auto' && <QueuePlace pr={pr} place={mergeQueue} />
      ) : noMethod ? (
        link
      ) : (
        <MergeButton target={{ pr }} placement={placement} />
      )}
      {off}
    </>
  );
}

type MergeButtonProps = { target: MergeTarget; placement?: MergePlacement } & Partial<
  Omit<ButtonProps, 'onClick' | 'size' | 'loading' | 'disabled'>
>;

/**
 * What opens `MergeDialog` for `target`: named after what a lone PR's plan offers ("Merge",
 * "Merge without waiting", "Enable auto-merge", "Add to merge queue", "Merge when ready") and
 * emphasized only when ready, or as its caller names it for a stack. Hidden while it offers
 * nothing, but the dialog it opened stays open across polls.
 */
export function MergeButton({ target, placement, children, ...button }: MergeButtonProps) {
  const [open, setOpen] = useState(false);
  const { pr, stack } = target;
  const plan = mergePlan(target, mergeDetailOf(pr).detail, placement);
  const pending = pendingActions.value[pr.id];
  const mine = plan.verbs.some((verb) => plan.name(verb) === pending);
  const ready = stack !== undefined || isReadyToMerge(pr);
  const [first = 'merge'] = plan.verbs;
  const label = plan.verbs.includes('merge')
    ? t(ready ? 'merge' : 'mergeWithoutWaiting')
    : plan.name(first);
  return (
    <>
      {(stack || plan.verbs.length > 0) && (
        <Button
          size="sm"
          variant={ready ? 'primary' : 'secondary'}
          icon={<GitMergeIcon size={12} />}
          aria-label={children ? undefined : forPr(label, pr)}
          loading={mine}
          disabled={pending !== undefined && !mine}
          {...button}
          onClick={() => setOpen(true)}
        >
          {children ?? label}
        </Button>
      )}
      {open && <MergeDialog target={target} placement={placement} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * A stacked PR's Merge: GitHub's "merge up to here", which merges it with every open PR below it.
 * Offered when it is part of the stack's ready run from the bottom; otherwise says why not.
 */
function StackRoute({ pr }: { pr: PullRequest }) {
  const stack = pr.stack;
  if (!stack) return null;
  const members = stackMembers(Object.values(snapshot.value?.pullRequests ?? {}), stack.id);
  const { mergeable, total } = stackSummary(members);
  const upTo = mergeable.findIndex((member) => member.id === pr.id);
  const number = formatNumber(stack.number);
  if (upTo < 0) return <span class="merge-action__note">{t('stackMergeLater', number)}</span>;
  return (
    <MergeButton
      target={{ pr, stack: { members: mergeable.slice(0, upTo + 1), open: total } }}
      aria-label={t('stackMergeUpToAria', prRef(pr), number)}
    >
      {t('stackMergeUpTo')}
    </MergeButton>
  );
}

/** Where a queued PR stands, and a way out. */
function QueuePlace({
  pr,
  place,
}: {
  pr: PullRequest;
  place: NonNullable<PullRequestDetail['mergeQueue']>;
}) {
  const minutes = place.estimatedSeconds ? Math.ceil(place.estimatedSeconds / 60) : null;
  const position = formatNumber(place.position);
  return (
    <>
      <span class="merge-action__note" role="status">
        {minutes
          ? t('inMergeQueueEta', position, formatNumber(minutes))
          : t('inMergeQueue', position)}
      </span>
      <PrButton
        pr={pr}
        name={t('removeFromMergeQueue')}
        done={t('removedFromMergeQueue')}
        run={(client) => dequeuePullRequest(client, pr.id)}
      />
    </>
  );
}

/** "Turn off auto-merge" while it is on and the viewer may turn it off, with or without a queue. */
function TurnOffAutoMerge({ pr }: { pr: PullRequest }) {
  if (!pr.autoMerge || pr.viewerCanDisableAutoMerge !== true) return null;
  return (
    <PrButton
      pr={pr}
      name={t('turnOffAutoMerge')}
      done={t('autoMergeIsOffFor')}
      run={(client) => setAutoMerge(client, pr.id, null, pr.headSha)}
    />
  );
}

interface PrButtonProps {
  pr: PullRequest;
  /** The button's wording, which also names the pending action. */
  name: string;
  /** The toast's verb once GitHub confirmed. */
  done: string;
  run: (client: GitHubClient) => Promise<void>;
}

/** A one-click action on `pr` that needs no confirmation (it merges nothing). */
function PrButton({ pr, name, done, run }: PrButtonProps) {
  const pending = pendingActions.value[pr.id];
  return (
    <Button
      size="sm"
      aria-label={forPr(name, pr)}
      loading={pending === name}
      disabled={pending !== undefined && pending !== name}
      onClick={() => void runPrAction(pr, name, done, run)}
    >
      {name}
    </Button>
  );
}
