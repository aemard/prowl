import { useState } from 'preact/hooks';
import { isReadyToMerge } from '../../lib/diff/diffSnapshots';
import { mergePullRequest, setAutoMerge } from '../../lib/github/actions';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { sendToBackground } from '../state/background';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { auth } from '../state/store';
import { GitMergeIcon } from './icons';
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
  // GitHub only takes auto-merge for a PR that cannot merge yet (checks or reviews to come).
  const offerAutoMerge = pr.autoMergeAllowed && !pr.autoMerge && !isReadyToMerge(pr);
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && setConfirming(false);
  const merge = async () => {
    const merged = await runPrAction(pr, MERGE, 'Merged', (client) =>
      mergePullRequest(client, pr.id, { method, headSha: pr.headSha, title }),
    );
    setConfirming(false);
    if (merged) setTitle('');
    else void sendToBackground({ type: 'poll', force: true });
  };
  const enableAutoMerge = async () => {
    const enabled = await runPrAction(pr, ENABLE_AUTO_MERGE, 'Auto-merge is on for', (client) =>
      setAutoMerge(client, pr.id, method, pr.headSha, title),
    );
    setConfirming(false);
    if (enabled) setTitle('');
  };

  return (
    <>
      <Button
        size="sm"
        variant={isReadyToMerge(pr) ? 'primary' : 'secondary'}
        icon={<GitMergeIcon size={12} />}
        aria-label={`${MERGE} ${ref}`}
        loading={pending === MERGE}
        disabled={pending !== undefined && pending !== MERGE}
        onClick={() => setConfirming(true)}
      >
        {MERGE}
      </Button>
      {pr.autoMerge && (
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
      {confirming && (
        <Dialog
          open
          onClose={close}
          title="Merge pull request"
          description={
            offerAutoMerge
              ? `Merge ${ref} into ${pr.baseRefName} now, or let GitHub merge it once its checks and reviews pass.`
              : `Merge ${ref} into ${pr.baseRefName}.`
          }
          footer={
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
        </Dialog>
      )}
    </>
  );
}
