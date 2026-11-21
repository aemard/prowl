import { useState } from 'preact/hooks';
import { mergeStackUpTo } from '../../lib/github/stackMerge';
import { countMessage, formatNumber, t } from '../../lib/i18n';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { MERGE_METHOD_NAMES } from './prStatus';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';

export interface StackMergeDialogProps {
  /** The ready run at the bottom of the stack, in merge order; `top` is its last. */
  members: PullRequest[];
  top: PullRequest;
  size: number;
  onClose: () => void;
}

/**
 * Confirms merging the bottom of a stack: which pull requests, in which order, what happens to
 * the rest, now or through the merge queue, and with which method. GitHub merges them atomically
 * when asked to merge the top one (`mergeStackUpTo`).
 */
/** What the toast says GitHub did. */
const OUTCOMES = {
  merged: 'stackMerged',
  enqueued: 'addedToMergeQueue',
  pending: 'stackStillMerging',
} as const;

export function StackMergeDialog({ members, top, size, onClose }: StackMergeDialogProps) {
  const methods = top.allowedMergeMethods;
  const [method, setMethod] = useState<MergeMethod>(
    methods.includes(top.defaultMergeMethod) ? top.defaultMergeMethod : (methods[0] ?? 'merge'),
  );
  const [queue, setQueue] = useState(false);
  const busy = pendingActions.value[top.id] !== undefined;
  const stack = top.stack;
  if (!stack) return null;
  const title = countMessage(members.length, 'stackMergeOne', 'stackMergeOther');
  const merge = async () => {
    let outcome = '';
    const done = await runPrAction(
      top,
      title,
      () => outcome,
      async (client) => {
        const result = await mergeStackUpTo(client, top, { method, queue });
        outcome = t(OUTCOMES[result]);
      },
    );
    if (done) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={t(
        'stackMergeDescription',
        String(stack.number),
        top.repo.nameWithOwner,
        stack.base,
      )}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={() => void merge()}>
            {title}
          </Button>
        </>
      }
    >
      <ol class="stack-merge__list">
        {members.map((pr) => (
          <li key={pr.id}>
            <span class="stack-merge__position">{formatNumber(pr.stack?.position ?? 0)}</span>
            <span class="stack-merge__ref">{prRef(pr)}</span> {pr.title}
          </li>
        ))}
      </ol>
      {members.length < size && (
        <p class="stack-merge__rest">
          {t('stackMergeRest', formatNumber(size - members.length), stack.base)}
        </p>
      )}
      <HowFields
        queue={queue}
        setQueue={setQueue}
        method={method}
        setMethod={setMethod}
        methods={methods}
      />
    </Dialog>
  );
}

interface HowProps {
  queue: boolean;
  setQueue: (queue: boolean) => void;
  method: MergeMethod;
  setMethod: (method: MergeMethod) => void;
  methods: MergeMethod[];
}

/** Now or through the merge queue; the method only for a direct merge with a choice to make. */
function HowFields({ queue, setQueue, method, setMethod, methods }: HowProps) {
  return (
    <>
      <fieldset class="stack-merge__how">
        <legend>{t('stackMergeHow')}</legend>
        <label>
          <input
            type="radio"
            name="stack-merge-how"
            checked={!queue}
            onChange={() => setQueue(false)}
          />
          {t('stackMergeNow')}
        </label>
        <label>
          <input
            type="radio"
            name="stack-merge-how"
            checked={queue}
            onChange={() => setQueue(true)}
          />
          {t('stackMergeQueue')}
        </label>
      </fieldset>
      {!queue && methods.length > 1 && (
        <Select
          label={t('mergeMethod')}
          value={method}
          options={methods.map((value) => ({ value, label: MERGE_METHOD_NAMES[value] }))}
          onValueChange={setMethod}
        />
      )}
    </>
  );
}
