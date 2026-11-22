import { useState } from 'preact/hooks';
import { mergePullRequest, setAutoMerge } from '../../lib/github/actions';
import { t } from '../../lib/i18n';
import type { MergeMethod, PullRequest, PullRequestDetail } from '../../lib/model';
import { sendToBackground } from '../state/background';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { AlertIcon } from './icons';
import { type MergePlacement, mergeOptions, mergeReadiness } from './mergeReadiness';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';
import { TextField } from './ui/TextField';

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

/** The title GitHub gives the commit unless told otherwise (`PullRequestDetail.commitTitles`). */
function defaultCommitTitle(pr: PullRequest, detail: PullRequestDetail, method: MergeMethod) {
  const titles = detail.commitTitles;
  return (method === 'merge' ? titles?.merge : titles?.squash) ?? `${pr.title} (#${pr.number})`;
}

/**
 * The merge dialog's state. A commit title the user edited belongs to the method it was written
 * for: a squash title is not a merge commit's, so switching the method shows that method's own
 * title (GitHub's, or the user's earlier edit of it), and switching back restores the edit.
 */
export function useMergeControls(pr: PullRequest, detail: PullRequestDetail) {
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<MergeMethod>();
  // Per method, only once the user edits it: untouched, the field shows GitHub's own title.
  const [edited, setEdited] = useState<Partial<Record<MergeMethod, string>>>({});
  const pending = pendingActions.value[pr.id];
  const titleFor = (method: MergeMethod) =>
    edited[method] ?? defaultCommitTitle(pr, detail, method);
  const setTitle = (method: MergeMethod, title: string) =>
    setEdited((all) => ({ ...all, [method]: title }));
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && setConfirming(false);
  const merge = async (method: MergeMethod) => {
    const merged = await runPrAction(pr, t('merge'), t('merged'), (client) =>
      // Untouched, GitHub applies its own default, which is what the field showed.
      mergePullRequest(client, pr.id, { method, headSha: pr.headSha, title: edited[method] }),
    );
    setConfirming(false);
    if (merged) setEdited({});
    else void sendToBackground({ type: 'poll', force: true, afterCurrent: true });
  };
  const enableAutoMerge = async (method: MergeMethod) => {
    const enabled = await runPrAction(pr, t('enableAutoMerge'), t('autoMergeIsOnFor'), (client) =>
      setAutoMerge(client, pr.id, method, pr.headSha, edited[method]),
    );
    setConfirming(false);
    if (enabled) setEdited({});
  };
  return {
    confirming,
    setConfirming,
    picked,
    setPicked,
    titleFor,
    setTitle,
    pending,
    close,
    merge,
    enableAutoMerge,
  };
}

export type MergeControls = ReturnType<typeof useMergeControls>;

export interface MergeDialogProps {
  pr: PullRequest;
  detail: PullRequestDetail;
  methods: MergeMethod[];
  method: MergeMethod;
  controls: MergeControls;
  placement: MergePlacement;
}

/** Confirms a direct merge or auto-merge: the blockers it skips, the method and commit title. */
export function MergeDialog(props: MergeDialogProps) {
  const { pr, detail, methods, method, controls, placement } = props;
  const { pending, close, merge, enableAutoMerge } = controls;
  const ref = prRef(pr);
  const { ready, canMerge, offerAutoMerge } = mergeOptions(pr, placement);
  // The modal hides the blockers listed above the button: the dialog repeats them.
  const blockers = ready
    ? []
    : mergeReadiness(pr, detail)
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
          methodLabel={methods.length === 1 ? METHODS[method] : t('merge')}
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
      <MergeFields {...props} blockers={blockers} />
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
  methods,
  method,
  controls,
  blockers,
}: MergeDialogProps & { blockers: string[] }) {
  const { pending, titleFor, setPicked, setTitle } = controls;
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
          label={t('commitTitle')}
          value={titleFor(method)}
          readOnly={pending !== undefined}
          onValueChange={(title) => setTitle(method, title)}
        />
      )}
    </>
  );
}
