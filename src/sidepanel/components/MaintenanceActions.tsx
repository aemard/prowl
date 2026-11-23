import { rerunFailedChecks, setDraft, updateBranch } from '../../lib/github/maintenanceActions';
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { forPr, pendingActions, runPrAction } from '../state/prActions';
import { auth } from '../state/store';
import { GitPullRequestIcon, SyncIcon } from './icons';
import { Button } from './ui/Button';
import { Menu } from './ui/Menu';

/** Whether the viewer may re-run checks: GitHub requires write access to the repository. */
export const canRerun = (pr: PullRequest) =>
  pr.state === 'open' && pr.checks.failed > 0 && pr.viewerCanMerge;

/** Whether the viewer may switch draft state: the author or anyone with write access. */
export const canToggleDraft = (pr: PullRequest, viewer: string) =>
  pr.state === 'open' &&
  (pr.viewerCanMerge || pr.author?.login.toLowerCase() === viewer.toLowerCase());

/** The base branch moved on: whoever may push to the PR can bring it in (GitHub's "behind"). */
export const canUpdateBranch = (pr: PullRequest) =>
  pr.state === 'open' && pr.mergeStateStatus === 'behind' && pr.viewerCanUpdate;

export const updateBranchWith = (pr: PullRequest, method: 'merge' | 'rebase') =>
  runPrAction(pr, t('updateBranch'), t('updatedTheBranchOf'), (client) =>
    updateBranch(client, pr.id, pr.headSha, method),
  );

export const draftActionName = (pr: PullRequest) =>
  pr.isDraft ? t('readyForReview') : t('convertToDraft');

export const rerun = (pr: PullRequest) =>
  runPrAction(pr, t('reRunFailedChecks'), t('reRunningFailedChecksOf'), (client) =>
    rerunFailedChecks(client, pr.id),
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
  return (
    <>
      {canRerun(pr) && (
        <Button
          size="sm"
          icon={<SyncIcon size={12} />}
          aria-label={forPr(t('reRunFailedChecks'), pr)}
          loading={pending === t('reRunFailedChecks')}
          disabled={pending !== undefined && pending !== t('reRunFailedChecks')}
          onClick={() => void rerun(pr)}
        >
          {t('rerunFailed')}
        </Button>
      )}
      {canUpdateBranch(pr) && (
        <Menu
          label={forPr(t('updateBranch'), pr)}
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
              aria-label={forPr(t('updateBranch'), pr)}
              loading={pending === t('updateBranch')}
              disabled={pending !== undefined && pending !== t('updateBranch')}
            >
              {t('updateBranch')}
            </Button>
          )}
        />
      )}
      {pr.isDraft && canToggleDraft(pr, viewer) && (
        <Button
          size="sm"
          icon={<GitPullRequestIcon size={12} />}
          aria-label={forPr(draftName, pr)}
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
