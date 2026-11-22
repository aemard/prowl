import { useState } from 'preact/hooks';
import { dequeuePullRequest, enqueuePullRequest, setAutoMerge } from '../../lib/github/actions';
import type { GitHubClient } from '../../lib/github/client';
import { formatNumber, t } from '../../lib/i18n';
import type { MergeMethod, PullRequest, PullRequestDetail } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { type MergePlacement, mergeOptions } from './mergeReadiness';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import './MergeQueueAction.css';

export interface MergeQueueActionProps {
  pr: PullRequest;
  /** The PR's place in the queue, or null when it is not queued. */
  queue: NonNullable<PullRequestDetail['mergeQueue']> | null;
  placement: MergePlacement;
  /** What auto-merge is turned on with; the queue's own settings decide how it merges. */
  method: MergeMethod | undefined;
}

/**
 * Merging on a branch that merges through a merge queue, under the readiness rules of Merge
 * (`mergeOptions`): where a queued PR stands and a way out; "Add to merge queue" when the PR is
 * ready; otherwise GitHub's "Merge when ready" (auto-merge, which queues the PR once its checks
 * and reviews pass). Both behind a confirmation, since they merge later without another click,
 * and pinned to the head the user saw.
 */
export function MergeQueueAction({ pr, queue, placement, method }: MergeQueueActionProps) {
  const busy = pendingActions.value[pr.id] !== undefined;
  if (queue) {
    if (placement === 'auto') return null;
    const minutes = queue.estimatedSeconds ? Math.ceil(queue.estimatedSeconds / 60) : null;
    return (
      <>
        <span class="merge-queue__position" role="status">
          {minutes
            ? t('inMergeQueueEta', formatNumber(queue.position), formatNumber(minutes))
            : t('inMergeQueue', formatNumber(queue.position))}
        </span>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void runPrAction(pr, t('removeFromMergeQueue'), t('removedFromMergeQueue'), (c) =>
              dequeuePullRequest(c, pr.id),
            )
          }
        >
          {t('removeFromMergeQueue')}
        </Button>
      </>
    );
  }
  const { canMerge, offerAutoMerge } = mergeOptions(pr, placement, true);
  return (
    <>
      {canMerge && (
        <Confirmed
          pr={pr}
          label={t('addToMergeQueue')}
          description={t('addToMergeQueueDescription', prRef(pr), pr.baseRefName)}
          done={t('addedToMergeQueue')}
          run={(c) => enqueuePullRequest(c, pr.id, pr.headSha)}
        />
      )}
      {offerAutoMerge && method && (
        <Confirmed
          pr={pr}
          label={t('mergeWhenReady')}
          description={t('mergeWhenReadyDescription', prRef(pr), pr.baseRefName)}
          done={t('autoMergeIsOnFor')}
          run={(c) => setAutoMerge(c, pr.id, method, pr.headSha)}
        />
      )}
    </>
  );
}

/** A button that confirms `label` in a dialog, then runs it as the PR's action. */
function Confirmed({
  pr,
  label,
  description,
  done,
  run,
}: {
  pr: PullRequest;
  label: string;
  description: string;
  done: string;
  run: (client: GitHubClient) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const pending = pendingActions.value[pr.id];
  const confirm = async () => {
    if (await runPrAction(pr, label, done, run)) setConfirming(false);
  };
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        aria-label={t('message2', label, prRef(pr))}
        loading={pending === label && !confirming}
        disabled={pending !== undefined && pending !== label}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
      <Dialog
        open={confirming}
        onClose={() => pending === undefined && setConfirming(false)}
        title={label}
        description={description}
        footer={
          <>
            <Button disabled={pending !== undefined} onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={pending === label} onClick={() => void confirm()}>
              {label}
            </Button>
          </>
        }
      />
    </>
  );
}
