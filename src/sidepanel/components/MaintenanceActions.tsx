import { rerunFailedChecks, setDraft, updateBranch } from '../../lib/github/actions';
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { auth } from '../state/store';
import { GitPullRequestDraftIcon, GitPullRequestIcon, SyncIcon } from './icons';
import { Button } from './ui/Button';
import { Menu } from './ui/Menu';

export const RERUN = t('reRunFailedChecks');

/** Whether the viewer may re-run checks: GitHub requires write access to the repository. */
export const canRerun = (pr: PullRequest) =>
  pr.state === 'open' && pr.checks.failed > 0 && pr.viewerCanMerge;

/** Whether the viewer may switch draft state: the author or anyone with write access. */
export const canToggleDraft = (pr: PullRequest, viewer: string) =>
  pr.state === 'open' &&
  (pr.viewerCanMerge || pr.author?.login.toLowerCase() === viewer.toLowerCase());

export const UPDATE_BRANCH = t('updateBranch');

/** The base branch moved on: whoever may push to the PR can bring it in (GitHub's "behind"). */
export const canUpdateBranch = (pr: PullRequest) =>
  pr.state === 'open' && pr.mergeStateStatus === 'behind' && pr.viewerCanUpdate;

export const updateBranchWith = (pr: PullRequest, method: 'merge' | 'rebase') =>
  runPrAction(pr, UPDATE_BRANCH, t('updatedTheBranchOf'), (client) =>
    updateBranch(client, pr.id, pr.headSha, method),
  );

export const draftActionName = (pr: PullRequest) =>
  pr.isDraft ? t('readyForReview') : t('convertToDraft');

export const rerun = (pr: PullRequest) =>
  runPrAction(pr, RERUN, t('reRunningFailedChecksOf'), (client) =>
    rerunFailedChecks(client, pr.id).then(() => undefined),
  );

export const toggleDraft = (pr: PullRequest) =>
  runPrAction(
    pr,
    draftActionName(pr),
    pr.isDraft ? t('markedReadyForReview') : t('convertedToDraft'),
    (client) => setDraft(client, pr.id, !pr.isDraft),
  );

/** Re-run failed checks and the draft toggle, for the Actions row of an expanded card. */
export function MaintenanceActions({ pr }: { pr: PullRequest }) {
  const viewer = auth.value?.viewer.login;
  if (!viewer) return null;
  const pending = pendingActions.value[pr.id];
  const draftName = draftActionName(pr);
  const ref = prRef(pr);
  return (
    <>
      {canUpdateBranch(pr) && (
        <Menu
          label={t('of', UPDATE_BRANCH, ref)}
          items={[
            {
              id: 'merge',
              label: t('updateWithMerge'),
              onSelect: () => void updateBranchWith(pr, 'merge'),
            },
            {
              id: 'rebase',
              label: t('updateWithARebase'),
              onSelect: () => void updateBranchWith(pr, 'rebase'),
            },
          ]}
          trigger={(props) => (
            <Button
              {...props}
              size="sm"
              icon={<SyncIcon size={12} />}
              aria-label={t('of', UPDATE_BRANCH, ref)}
              loading={pending === UPDATE_BRANCH}
              disabled={pending !== undefined && pending !== UPDATE_BRANCH}
            >
              {UPDATE_BRANCH}
            </Button>
          )}
        />
      )}
      {canRerun(pr) && (
        <Button
          size="sm"
          icon={<SyncIcon size={12} />}
          aria-label={t('of', RERUN, ref)}
          loading={pending === RERUN}
          disabled={pending !== undefined && pending !== RERUN}
          onClick={() => void rerun(pr)}
        >
          {t('rerunFailed')}
        </Button>
      )}
      {canToggleDraft(pr, viewer) && (
        <Button
          size="sm"
          icon={
            pr.isDraft ? <GitPullRequestIcon size={12} /> : <GitPullRequestDraftIcon size={12} />
          }
          aria-label={t('actionReference', draftName, ref)}
          loading={pending === draftName}
          disabled={pending !== undefined && pending !== draftName}
          onClick={() => void toggleDraft(pr)}
        >
          {draftName}
        </Button>
      )}
    </>
  );
}
