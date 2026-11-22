import { useEffect, useState } from 'preact/hooks';
import { mergeStackUpTo } from '../../lib/github/stackMerge';
import { countMessage, formatNumber, t } from '../../lib/i18n';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { loadDetail } from '../state/loadDetail';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { detailKey, detailOf } from '../state/prDetail';
import { GitHubLink } from './GitHubLink';
import { pickMethod } from './mergeReadiness';
import { MERGE_METHOD_NAMES } from './prStatus';
import { Button, type ButtonProps } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';
import './StackMergeDialog.css';

export interface StackMergeTarget {
  /** The ready run at the bottom of the stack, in merge order; `top` is its last. */
  members: PullRequest[];
  top: PullRequest;
  /** How many pull requests of the stack are open. */
  size: number;
}

/** What the toast says GitHub did. */
const OUTCOMES = {
  merged: 'stackMerged',
  enqueued: 'addedToMergeQueue',
  pending: 'stackStillMerging',
} as const;

/** The heads the dialog lists, to tell whether one moved since. */
const heads = (members: PullRequest[]) => members.map((pr) => `${pr.id}@${pr.headSha}`).join(' ');

/** The dialog's state: what the top's detail says about the base, and the guarded merge. */
function useStackMerge({ members, top }: StackMergeTarget, onClose: () => void) {
  const [seen, setSeen] = useState(() => heads(members));
  const [picked, setPicked] = useState<MergeMethod>();
  const [error, setError] = useState<string>();
  useEffect(() => void loadDetail(top), [detailKey(top)]);
  const { detail, failed } = detailOf(top);
  const busy = pendingActions.value[top.id] !== undefined;
  const stack = top.stack;
  const queue = detail?.mergeQueue !== undefined;
  const methods = detail?.allowedMergeMethods ?? top.allowedMergeMethods;
  const method = pickMethod(methods, picked, top.defaultMergeMethod);
  const title = queue
    ? countMessage(members.length, 'stackQueueOne', 'stackQueueOther')
    : countMessage(members.length, 'stackMergeOne', 'stackMergeOther');
  const close = () => !busy && onClose();
  const merge = async () => {
    setError(undefined);
    if (heads(members) !== seen) {
      setSeen(heads(members));
      return setError(t('stackChangedSinceOpened'));
    }
    let outcome = '';
    const done = await runPrAction(
      top,
      title,
      () => outcome,
      async (client) => {
        const result = await mergeStackUpTo(client, top, { method: method ?? 'merge', queue });
        outcome = t(OUTCOMES[result]);
      },
      setError,
    );
    if (done) onClose();
  };
  const how: HowProps['how'] = detail
    ? queue || method
      ? 'ready'
      : 'github'
    : failed
      ? 'github'
      : 'loading';
  return { stack, queue, methods, method, setPicked, title, busy, error, close, merge, how };
}

/**
 * Confirms merging the bottom of a stack: which pull requests, in which order, what happens to
 * the rest, and how, from the top's detail like the card's own Merge: through the merge queue
 * when the base branch has one, else now with a method its rules allow. GitHub merges them
 * atomically when asked to merge the top one (`mergeStackUpTo`), pinned to the top's head only:
 * the members below merge as GitHub has them, so the dialog refuses once when one of their heads
 * (or the run) changed in the snapshot since it opened, and asks to confirm the list again.
 * Failures stay in the dialog; it cannot be dismissed while the merge is sent.
 */
export function StackMergeDialog({
  members,
  top,
  size,
  onClose,
}: StackMergeTarget & { onClose: () => void }) {
  const { stack, queue, methods, method, setPicked, title, busy, error, close, merge, how } =
    useStackMerge({ members, top, size }, onClose);
  if (!stack) return null;
  return (
    <Dialog
      open
      onClose={close}
      title={title}
      description={t(
        'stackMergeDescription',
        formatNumber(stack.number),
        top.repo.nameWithOwner,
        stack.base,
      )}
      error={error}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={how !== 'ready'}
            onClick={() => void merge()}
          >
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
      <HowItMerges
        how={how}
        top={top}
        queue={queue}
        methods={methods}
        method={method}
        busy={busy}
        onMethod={setPicked}
      />
    </Dialog>
  );
}

interface HowProps {
  how: 'loading' | 'github' | 'ready';
  top: PullRequest;
  queue: boolean;
  methods: MergeMethod[];
  method: MergeMethod | undefined;
  busy: boolean;
  onMethod: (method: MergeMethod) => void;
}

/** Through the queue, or now with which method; while the detail loads, or why not from here. */
function HowItMerges({ how, top, queue, methods, method, busy, onMethod }: HowProps) {
  const base = top.stack?.base ?? top.baseRefName;
  if (how === 'loading') return <p role="status">{t('stackMergeChecking', base)}</p>;
  if (how === 'github')
    return (
      <p>
        {t('stackMergeUnknown', base)} <GitHubLink href={top.url}>{t('mergeOnGitHub')}</GitHubLink>
      </p>
    );
  if (queue) return <p>{t('stackMergeQueued', base)}</p>;
  return method && methods.length > 1 ? (
    <Select
      label={t('mergeMethod')}
      value={method}
      options={methods.map((value) => ({ value, label: MERGE_METHOD_NAMES[value] }))}
      disabled={busy}
      onValueChange={onMethod}
    />
  ) : null;
}

/** A button that opens `StackMergeDialog` for `members` up to `top`. */
export function StackMergeButton({
  members,
  top,
  size,
  children,
  ...button
}: StackMergeTarget & Omit<ButtonProps, 'onClick' | 'size'>) {
  const [merging, setMerging] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" {...button} onClick={() => setMerging(true)}>
        {children}
      </Button>
      {merging && (
        <StackMergeDialog
          members={members}
          top={top}
          size={size}
          onClose={() => setMerging(false)}
        />
      )}
    </>
  );
}
