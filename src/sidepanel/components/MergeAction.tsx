import { useState } from 'preact/hooks';
import { isReadyToMerge } from '../../lib/diff/diffSnapshots';
import { mergePullRequest, setAutoMerge } from '../../lib/github/actions';
import { t } from '../../lib/i18n';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { sendToBackground } from '../state/background';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { detailKey, details } from '../state/prDetail';
import { auth } from '../state/store';
import { GitHubLink } from './GitHubLink';
import { AlertIcon, GitMergeIcon } from './icons';
import { mergeReadiness } from './mergeReadiness';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';
import { TextField } from './ui/TextField';
import './MergeAction.css';

const METHODS: Record<MergeMethod, string> = {
  get merge() {
    return t('createAMergeCommit');
  },
  get squash() {
    return t('squashAndMerge');
  },
  get rebase() {
    return t('rebaseAndMerge');
  },
};

function useMergeControls(pr: PullRequest) {
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<MergeMethod>();
  const [title, setTitle] = useState('');
  const pending = pendingActions.value[pr.id];
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && setConfirming(false);
  const merge = async (method: MergeMethod) => {
    const merged = await runPrAction(pr, t('merge'), t('merged'), (client) =>
      mergePullRequest(client, pr.id, { method, headSha: pr.headSha, title }),
    );
    setConfirming(false);
    if (merged) setTitle('');
    else void sendToBackground({ type: 'poll', force: true, afterCurrent: true });
  };
  const enableAutoMerge = async (method: MergeMethod) => {
    const enabled = await runPrAction(pr, t('enableAutoMerge'), t('autoMergeIsOnFor'), (client) =>
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
type Placement = 'merge' | 'auto' | 'all';
type MergeDialogProps = {
  pr: PullRequest;
  method: MergeMethod;
  controls: MergeControls;
  placement?: Placement;
};

function currentDetail(pr: PullRequest) {
  const entry = details.value[pr.id];
  return entry?.key === detailKey(pr) && !entry.loading && !entry.error ? entry.detail : undefined;
}

/**
 * What the merge control may offer, so it never contradicts the blockers listed above it: Merge
 * when GitHub's verdict is ready; "Merge without waiting" when it is not but the viewer can bypass
 * the rules (`viewerCanMergeAsAdmin`); otherwise auto-merge when the repository and the viewer
 * allow it, or nothing. Unverified merge facts offer nothing until a refresh fills them in.
 * GitHub still has the last word; a refusal shows its reason in a toast and requests a refresh.
 */
function mergeOptions(pr: PullRequest, placement: Placement = 'all') {
  const ready = isReadyToMerge(pr);
  const known =
    pr.mergeable !== 'unknown' &&
    pr.mergeStateStatus !== 'unknown' &&
    pr.reviewDecision !== 'unknown';
  return {
    ready,
    canMerge: placement !== 'auto' && known && (ready || pr.viewerCanMergeAsAdmin === true),
    offerAutoMerge:
      placement !== 'merge' &&
      known &&
      !ready &&
      pr.autoMergeAllowed &&
      !pr.autoMerge &&
      pr.viewerCanEnableAutoMerge === true,
  };
}

export function MergeAction({ pr, placement = 'all' }: { pr: PullRequest; placement?: Placement }) {
  const controls = useMergeControls(pr);
  const methods = currentDetail(pr)?.allowedMergeMethods ?? pr.allowedMergeMethods;
  const method =
    [controls.picked, pr.defaultMergeMethod].find((m) => m && methods.includes(m)) ?? methods[0];
  if (!auth.value || !pr.viewerCanMerge || pr.state !== 'open' || pr.isDraft) return null;
  if (!method)
    return placement === 'auto' ? null : (
      <GitHubLink href={pr.url}>{t('mergeOnGitHub')}</GitHubLink>
    );
  return (
    <>
      <MergeButtons pr={pr} controls={controls} placement={placement} />
      {controls.confirming &&
        (mergeOptions(pr, placement).canMerge || mergeOptions(pr, placement).offerAutoMerge) && (
          <MergeDialog pr={pr} method={method} controls={controls} placement={placement} />
        )}
    </>
  );
}

function MergeButtons({
  pr,
  controls,
  placement,
}: {
  pr: PullRequest;
  controls: MergeControls;
  placement: Placement;
}) {
  const { pending, setConfirming } = controls;
  const ref = prRef(pr);
  const { ready, canMerge, offerAutoMerge } = mergeOptions(pr, placement);
  const label = canMerge ? (ready ? t('merge') : t('mergeWithoutWaiting')) : t('enableAutoMerge');
  return (
    <>
      {(canMerge || offerAutoMerge) && (
        <Button
          size="sm"
          variant={ready ? 'primary' : 'secondary'}
          icon={<GitMergeIcon size={12} />}
          aria-label={t('message2', label, ref)}
          loading={pending === (canMerge ? t('merge') : t('enableAutoMerge'))}
          disabled={
            pending !== undefined && pending !== (canMerge ? t('merge') : t('enableAutoMerge'))
          }
          onClick={() => setConfirming(true)}
        >
          {label}
        </Button>
      )}
      {placement !== 'merge' && pr.autoMerge && pr.viewerCanDisableAutoMerge === true && (
        <Button
          size="sm"
          aria-label={t('of', t('turnOffAutoMerge'), ref)}
          loading={pending === t('turnOffAutoMerge')}
          disabled={pending !== undefined && pending !== t('turnOffAutoMerge')}
          onClick={() =>
            void runPrAction(pr, t('turnOffAutoMerge'), t('autoMergeIsOffFor'), (client) =>
              setAutoMerge(client, pr.id, null, pr.headSha),
            )
          }
        >
          {t('turnOffAutoMerge')}
        </Button>
      )}
    </>
  );
}

function MergeDialog({ pr, method, controls, placement = 'all' }: MergeDialogProps) {
  const { pending, close, merge, enableAutoMerge } = controls;
  const ref = prRef(pr);
  const { ready, canMerge, offerAutoMerge } = mergeOptions(pr, placement);
  // The modal hides the blockers listed above the button: the dialog repeats them.
  const blockers = ready
    ? []
    : mergeReadiness(pr, currentDetail(pr))
        .filter(({ tone }) => tone !== 'neutral' && tone !== 'success')
        .map(({ text }) => text.replace(/^Blocked: /, ''))
        .map((text) => text.charAt(0).toLowerCase() + text.slice(1));
  return (
    <Dialog
      open
      onClose={close}
      title={t('mergePullRequest')}
      description={
        !canMerge
          ? t('letGitHubMergeIntoOnceItsChecksAndReviewsPass', ref, pr.baseRefName)
          : offerAutoMerge
            ? t('mergeIntoNowOrLetGithubMergeItOnce', ref, pr.baseRefName)
            : t('mergeInto', ref, pr.baseRefName)
      }
      footer={
        <MergeFooter
          methodLabel={
            (currentDetail(pr)?.allowedMergeMethods ?? pr.allowedMergeMethods).length === 1
              ? METHODS[method]
              : t('merge')
          }
          pending={pending}
          offerAutoMerge={offerAutoMerge}
          canMerge={canMerge}
          close={close}
          merge={() => void merge(method)}
          enableAutoMerge={() => void enableAutoMerge(method)}
        />
      }
    >
      {canMerge && !ready && <p>{t('youCanBypassTheBranchRulesForThisPullRequest')}</p>}
      <MergeFields pr={pr} method={method} controls={controls} blockers={blockers} />
    </Dialog>
  );
}

function MergeFooter({
  methodLabel,
  pending,
  offerAutoMerge,
  canMerge,
  close,
  merge,
  enableAutoMerge,
}: {
  methodLabel: string;
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
        {t('cancel')}
      </Button>
      {offerAutoMerge && (
        <Button
          variant="primary"
          loading={pending === t('enableAutoMerge')}
          disabled={pending !== undefined && pending !== t('enableAutoMerge')}
          onClick={() => void enableAutoMerge()}
        >
          {t('enableAutoMerge')}
        </Button>
      )}
      {canMerge && (
        <Button
          variant={offerAutoMerge ? 'secondary' : 'primary'}
          loading={pending === t('merge')}
          disabled={pending !== undefined && pending !== t('merge')}
          onClick={() => void merge()}
        >
          {methodLabel}
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
  const detail = currentDetail(pr);
  const methods = detail?.allowedMergeMethods ?? pr.allowedMergeMethods;
  return (
    <>
      <p class="merge-dialog__pr">{pr.title}</p>
      {blockers.length > 0 && (
        <p class="merge-dialog__blockers">
          <AlertIcon size={12} />
          <span>{t('notReadyReasons', blockers.join('; '))}</span>
        </p>
      )}
      {methods.length > 1 && (
        <Select
          label={t('mergeMethod')}
          value={method}
          options={methods.map((value) => ({ value, label: METHODS[value] }))}
          disabled={pending !== undefined}
          onValueChange={setPicked}
        />
      )}
      {method !== 'rebase' && (
        <TextField
          label={t('commitTitleOptional')}
          hint={t('emptyUsesGithubSDefault')}
          value={title}
          readOnly={pending !== undefined}
          onValueChange={setTitle}
        />
      )}
    </>
  );
}
