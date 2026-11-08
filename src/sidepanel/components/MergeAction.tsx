import { useState } from 'preact/hooks';
import { isReadyToMerge } from '../../lib/diff/diffSnapshots';
import { mergePullRequest, setAutoMerge } from '../../lib/github/actions';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { sendToBackground } from '../state/background';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { details } from '../state/prDetail';
import { auth } from '../state/store';
import { AlertIcon, GitMergeIcon } from './icons';
import { mergeReadiness } from './mergeReadiness';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';
import { TextField } from './ui/TextField';
import './MergeAction.css';

const METHODS: Record<MergeMethod, string> = {
  merge: 'Create a merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

const MERGE = 'Merge';
const ENABLE_AUTO_MERGE = 'Enable auto-merge';
const DISABLE_AUTO_MERGE = 'Disable auto-merge';

function useMergeControls(pr: PullRequest) {
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<MergeMethod>();
  const [title, setTitle] = useState('');
  const pending = pendingActions.value[pr.id];
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && setConfirming(false);
  const merge = async (method: MergeMethod) => {
    const merged = await runPrAction(pr, MERGE, 'Merged', (client) =>
      mergePullRequest(client, pr.id, { method, headSha: pr.headSha, title }),
    );
    setConfirming(false);
    if (merged) setTitle('');
    else void sendToBackground({ type: 'poll', force: true, afterCurrent: true });
  };
  const enableAutoMerge = async (method: MergeMethod) => {
    const enabled = await runPrAction(pr, ENABLE_AUTO_MERGE, 'Auto-merge is on for', (client) =>
      setAutoMerge(client, pr.id, method, pr.headSha, title),
    );
    setConfirming(false);
    if (enabled) setTitle('');
  };

  return {
    confirming,
    setConfirming,
    picked,
    setPicked,
    title,
    setTitle,
    pending,
    close,
    merge,
    enableAutoMerge,
  };
}

type MergeControls = ReturnType<typeof useMergeControls>;
type MergeDialogProps = { pr: PullRequest; method: MergeMethod; controls: MergeControls };

/** Offers immediate merging only with verified readiness or permission to bypass rules. */
function mergeOptions(pr: PullRequest) {
  const ready = isReadyToMerge(pr);
  const known =
    pr.mergeable !== 'unknown' &&
    pr.mergeStateStatus !== 'unknown' &&
    pr.reviewDecision !== 'unknown';
  return {
    ready,
    canMerge: known && (ready || pr.viewerCanMergeAsAdmin === true),
    offerAutoMerge:
      known &&
      !ready &&
      pr.autoMergeAllowed &&
      !pr.autoMerge &&
      pr.viewerCanEnableAutoMerge === true,
  };
}

export function MergeAction({ pr }: { pr: PullRequest }) {
  const controls = useMergeControls(pr);
  const method =
    [controls.picked, pr.defaultMergeMethod].find((m) => m && pr.allowedMergeMethods.includes(m)) ??
    pr.allowedMergeMethods[0];
  if (!method || !auth.value || !pr.viewerCanMerge || pr.state !== 'open' || pr.isDraft)
    return null;
  return (
    <>
      <MergeButtons pr={pr} controls={controls} />
      {controls.confirming && (mergeOptions(pr).canMerge || mergeOptions(pr).offerAutoMerge) && (
        <MergeDialog pr={pr} method={method} controls={controls} />
      )}
    </>
  );
}

function MergeButtons({ pr, controls }: { pr: PullRequest; controls: MergeControls }) {
  const { pending, setConfirming } = controls;
  const ref = prRef(pr);
  const { ready, canMerge, offerAutoMerge } = mergeOptions(pr);
  const label = canMerge ? (ready ? MERGE : 'Merge without waiting') : ENABLE_AUTO_MERGE;
  return (
    <>
      {(canMerge || offerAutoMerge) && (
        <Button
          size="sm"
          variant={ready ? 'primary' : 'secondary'}
          icon={<GitMergeIcon size={12} />}
          aria-label={`${label} ${ref}`}
          loading={pending === (canMerge ? MERGE : ENABLE_AUTO_MERGE)}
          disabled={pending !== undefined && pending !== (canMerge ? MERGE : ENABLE_AUTO_MERGE)}
          onClick={() => setConfirming(true)}
        >
          {label}
        </Button>
      )}
      {pr.autoMerge && pr.viewerCanDisableAutoMerge === true && (
        <Button
          size="sm"
          aria-label={`${DISABLE_AUTO_MERGE} of ${ref}`}
          loading={pending === DISABLE_AUTO_MERGE}
          disabled={pending !== undefined && pending !== DISABLE_AUTO_MERGE}
          onClick={() =>
            void runPrAction(pr, DISABLE_AUTO_MERGE, 'Auto-merge is off for', (client) =>
              setAutoMerge(client, pr.id, null, pr.headSha),
            )
          }
        >
          {DISABLE_AUTO_MERGE}
        </Button>
      )}
    </>
  );
}

function MergeDialog({ pr, method, controls }: MergeDialogProps) {
  const { pending, close, merge, enableAutoMerge } = controls;
  const ref = prRef(pr);
  const { ready, canMerge, offerAutoMerge } = mergeOptions(pr);
  // The modal hides the blockers listed above the button: the dialog repeats them.
  const blockers = ready
    ? []
    : mergeReadiness(pr, details.value[pr.id]?.detail)
        .filter(({ tone }) => tone !== 'neutral' && tone !== 'success')
        .map(({ text }) => text.replace(/^Blocked: /, ''))
        .map((text) => text.charAt(0).toLowerCase() + text.slice(1));
  return (
    <Dialog
      open
      onClose={close}
      title="Merge pull request"
      description={
        !canMerge
          ? `Let GitHub merge ${ref} into ${pr.baseRefName} once its checks and reviews pass.`
          : offerAutoMerge
            ? `Merge ${ref} into ${pr.baseRefName} now, or let GitHub merge it once its checks and reviews pass.`
            : `Merge ${ref} into ${pr.baseRefName}.`
      }
      footer={
        <MergeFooter
          pending={pending}
          offerAutoMerge={offerAutoMerge}
          canMerge={canMerge}
          close={close}
          merge={() => void merge(method)}
          enableAutoMerge={() => void enableAutoMerge(method)}
        />
      }
    >
      {canMerge && !ready && <p>You can bypass the branch rules for this pull request.</p>}
      <MergeFields pr={pr} method={method} controls={controls} blockers={blockers} />
    </Dialog>
  );
}

function MergeFooter({
  pending,
  offerAutoMerge,
  canMerge,
  close,
  merge,
  enableAutoMerge,
}: {
  pending: string | undefined;
  offerAutoMerge: boolean;
  canMerge: boolean;
  close: () => void;
  merge: () => void;
  enableAutoMerge: () => void;
}) {
  return (
    <>
      <Button disabled={pending !== undefined} onClick={close}>
        Cancel
      </Button>
      {offerAutoMerge && (
        <Button
          variant="primary"
          loading={pending === ENABLE_AUTO_MERGE}
          disabled={pending !== undefined && pending !== ENABLE_AUTO_MERGE}
          onClick={() => void enableAutoMerge()}
        >
          {ENABLE_AUTO_MERGE}
        </Button>
      )}
      {canMerge && (
        <Button
          variant={offerAutoMerge ? 'secondary' : 'primary'}
          loading={pending === MERGE}
          disabled={pending !== undefined && pending !== MERGE}
          onClick={() => void merge()}
        >
          {MERGE}
        </Button>
      )}
    </>
  );
}

function MergeFields({
  pr,
  method,
  controls,
  blockers,
}: MergeDialogProps & { blockers: string[] }) {
  const { pending, title, setPicked, setTitle } = controls;
  const methods = pr.allowedMergeMethods;
  return (
    <>
      <p class="merge-dialog__pr">{pr.title}</p>
      {blockers.length > 0 && (
        <p class="merge-dialog__blockers">
          <AlertIcon size={12} />
          <span>Not ready: {blockers.join('; ')}.</span>
        </p>
      )}
      <Select
        label="Merge method"
        value={method}
        options={methods.map((value) => ({ value, label: METHODS[value] }))}
        disabled={pending !== undefined}
        hint={
          method === 'rebase'
            ? 'Commits are kept as they are, so there is no commit title.'
            : undefined
        }
        onValueChange={setPicked}
      />
      {method !== 'rebase' && (
        <TextField
          label="Commit title (optional)"
          hint="Empty uses GitHub's default."
          value={title}
          readOnly={pending !== undefined}
          onValueChange={setTitle}
        />
      )}
    </>
  );
}
