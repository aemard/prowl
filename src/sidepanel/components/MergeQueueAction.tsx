import { useState } from 'preact/hooks';
import { dequeuePullRequest, enqueuePullRequest } from '../../lib/github/mergeActions';
import { formatNumber, t } from '../../lib/i18n';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import './MergeQueueAction.css';

/**
 * Merging on a branch that merges through a merge queue: where the PR stands in the queue and
 * a way out of it, or "Add to merge queue" behind a confirmation (it merges the PR later, without
 * another click). Pinned to the head the user saw, like Merge.
 */
export function MergeQueueAction({
  pr,
  queue,
}: {
  pr: PullRequest;
  queue: NonNullable<PullRequestDetail['mergeQueue']> | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const busy = pendingActions.value[pr.id] !== undefined;
  if (queue) {
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
  const enqueue = async () => {
    const done = await runPrAction(pr, t('addToMergeQueue'), t('addedToMergeQueue'), (c) =>
      enqueuePullRequest(c, pr.id, pr.headSha),
    );
    if (done) setConfirming(false);
  };
  return (
    <>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirming(true)}>
        {t('addToMergeQueue')}
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('addToMergeQueue')}
        description={t('addToMergeQueueDescription', prRef(pr), pr.baseRefName)}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busy} onClick={() => void enqueue()}>
              {t('addToMergeQueue')}
            </Button>
          </>
        }
      />
    </>
  );
}
