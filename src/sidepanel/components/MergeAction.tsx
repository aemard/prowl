import { useState } from 'preact/hooks';
import { isReadyToMerge } from '../../lib/diff/diffSnapshots';
import { mergePullRequest, setAutoMerge } from '../../lib/github/actions';
import { t } from '../../lib/i18n';
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
  merge: t('createAMergeCommit'),
  squash: t('squashAndMerge'),
  rebase: t('rebaseAndMerge'),
};

const MERGE = t('merge');
const ENABLE_AUTO_MERGE = t('enableAutoMerge');
const DISABLE_AUTO_MERGE = t('disableAutoMerge');

/**
 * Merge, for the row of an expanded card's Actions: shown to someone with write access on an
 * open pull request that is not a draft, and only when the repository allows a method. The
 * button (emphasized only once the PR is ready to merge, so it does not contradict the blockers
 * listed above it) opens a confirmation with the pull request, its target branch, a picker of
 * the allowed methods (starting on `defaultMergeMethod`, GitHub's "last used or the
 * repository's") and an optional commit title. GitHub has the last word on whether it can be
 * merged: it answers with the reason (blocked, conflicts, head moved since the last poll), which
 * a toast shows after the dialog closed (a modal would hide it); the choices stay for the next
 * try, and a refresh is requested because such a refusal usually means the PR changed.
 */
export function MergeAction({ pr }: { pr: PullRequest }) {
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<MergeMethod>();
  const [title, setTitle] = useState('');
  const methods = pr.allowedMergeMethods;
  const method =
    [picked, pr.defaultMergeMethod].find((m) => m && methods.includes(m)) ?? methods[0];
  if (!method || !auth.value || !pr.viewerCanMerge || pr.state !== 'open' || pr.isDraft) {
    return null;
  }

  const ref = prRef(pr);
  const pending = pendingActions.value[pr.id];
  const ready = isReadyToMerge(pr);
  // GitHub only takes auto-merge for a PR that cannot merge yet (checks or reviews to come).
  const offerAutoMerge = pr.autoMergeAllowed && !pr.autoMerge && !ready;
  // The modal hides the blockers listed above the button: the dialog repeats them.
  const blockers = ready
    ? []
    : mergeReadiness(pr, details.value[pr.id]?.detail)
        .filter(({ tone }) => tone !== 'neutral' && tone !== 'success')
        .map(({ text }) => text.replace(/^Blocked: /, ''))
        .map((text) => text.charAt(0).toLowerCase() + text.slice(1));
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && setConfirming(false);
  const merge = async () => {
    const merged = await runPrAction(pr, MERGE, t('merged'), (client) =>
      mergePullRequest(client, pr.id, { method, headSha: pr.headSha, title }),
    );
    setConfirming(false);
    if (merged) setTitle('');
    else void sendToBackground({ type: 'poll', force: true });
  };
  const enableAutoMerge = async () => {
    const enabled = await runPrAction(pr, ENABLE_AUTO_MERGE, t('autoMergeIsOnFor'), (client) =>
      setAutoMerge(client, pr.id, method, pr.headSha, title),
    );
    setConfirming(false);
    if (enabled) setTitle('');
  };

  return (
    <>
      <Button
        size="sm"
        variant={ready ? 'primary' : 'secondary'}
        icon={<GitMergeIcon size={12} />}
        aria-label={t('message2', MERGE, ref)}
        loading={pending === MERGE}
        disabled={pending !== undefined && pending !== MERGE}
        onClick={() => setConfirming(true)}
      >
        {MERGE}
      </Button>
      {pr.autoMerge && (
        <Button
          size="sm"
          aria-label={t('of', DISABLE_AUTO_MERGE, ref)}
          loading={pending === DISABLE_AUTO_MERGE}
          disabled={pending !== undefined && pending !== DISABLE_AUTO_MERGE}
          onClick={() =>
            void runPrAction(pr, DISABLE_AUTO_MERGE, t('autoMergeIsOffFor'), (client) =>
              setAutoMerge(client, pr.id, null, pr.headSha),
            )
          }
        >
          {DISABLE_AUTO_MERGE}
        </Button>
      )}
      {confirming && (
        <Dialog
          open
          onClose={close}
          title={t('mergePullRequest')}
          description={
            offerAutoMerge
              ? t('mergeIntoNowOrLetGithubMergeItOnce', ref, pr.baseRefName)
              : t('mergeInto', ref, pr.baseRefName)
          }
          footer={
            <>
              <Button disabled={pending !== undefined} onClick={close}>
                {t('cancel')}
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
              <Button
                variant={offerAutoMerge ? 'secondary' : 'primary'}
                loading={pending === MERGE}
                disabled={pending !== undefined && pending !== MERGE}
                onClick={() => void merge()}
              >
                {MERGE}
              </Button>
            </>
          }
        >
          <p class="merge-dialog__pr">{pr.title}</p>
          {blockers.length > 0 && (
            <p class="merge-dialog__blockers">
              <AlertIcon size={12} />
              <span>{t('notReadyReasons', blockers.join('; '))}</span>
            </p>
          )}
          <Select
            label={t('mergeMethod')}
            value={method}
            options={methods.map((value) => ({ value, label: METHODS[value] }))}
            disabled={pending !== undefined}
            hint={method === 'rebase' ? t('commitsAreKeptAsTheyAreSoThereIs') : undefined}
            onValueChange={setPicked}
          />
          {method !== 'rebase' && (
            <TextField
              label={t('commitTitleOptional')}
              hint={t('emptyUsesGithubSDefault')}
              value={title}
              readOnly={pending !== undefined}
              onValueChange={setTitle}
            />
          )}
        </Dialog>
      )}
    </>
  );
}
