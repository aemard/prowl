import { rerunFailedChecks, setDraft, updateBranch } from '../../lib/github/actions';
import type { PullRequest } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { auth } from '../state/store';
import { GitPullRequestDraftIcon, GitPullRequestIcon, SyncIcon } from './icons';
import { Button } from './ui/Button';
import { Menu } from './ui/Menu';

export const RERUN = 'Re-run failed checks';

/** Whether the viewer may re-run checks: GitHub requires write access to the repository. */
export const canRerun = (pr: PullRequest) =>
  pr.state === 'open' && pr.checks.failed > 0 && pr.viewerCanMerge;

/** Whether the viewer may switch draft state: the author or anyone with write access. */
export const canToggleDraft = (pr: PullRequest, viewer: string) =>
  pr.state === 'open' &&
  (pr.viewerCanMerge || pr.author?.login.toLowerCase() === viewer.toLowerCase());

export const UPDATE_BRANCH = 'Update branch';

/** The base branch moved on: whoever may push to the PR can bring it in (GitHub's "behind"). */
export const canUpdateBranch = (pr: PullRequest) =>
  pr.state === 'open' && pr.mergeStateStatus === 'behind' && pr.viewerCanUpdate;

export const updateBranchWith = (pr: PullRequest, method: 'merge' | 'rebase') =>
  runPrAction(pr, UPDATE_BRANCH, 'Updated the branch of', (client) =>
    updateBranch(client, pr.id, pr.headSha, method),
  );

export const draftActionName = (pr: PullRequest) =>
  pr.isDraft ? 'Ready for review' : 'Convert to draft';

export const rerun = (pr: PullRequest) =>
  runPrAction(pr, RERUN, 'Re-running failed checks of', (client) =>
    rerunFailedChecks(client, pr.id).then(() => undefined),
  );

export const toggleDraft = (pr: PullRequest) =>
  runPrAction(
    pr,
    draftActionName(pr),
    pr.isDraft ? 'Marked ready for review:' : 'Converted to draft:',
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
          label={`${UPDATE_BRANCH} of ${ref}`}
          items={[
            {
              id: 'merge',
              label: 'Update with a merge commit',
              onSelect: () => void updateBranchWith(pr, 'merge'),
            },
            {
              id: 'rebase',
              label: 'Update with a rebase',
              onSelect: () => void updateBranchWith(pr, 'rebase'),
            },
          ]}
          trigger={(props) => (
            <Button
              {...props}
              size="sm"
              icon={<SyncIcon size={12} />}
              aria-label={`${UPDATE_BRANCH} of ${ref}`}
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
          aria-label={`${RERUN} of ${ref}`}
          loading={pending === RERUN}
          disabled={pending !== undefined && pending !== RERUN}
          onClick={() => void rerun(pr)}
        >
          Re-run failed
        </Button>
      )}
      {canToggleDraft(pr, viewer) && (
        <Button
          size="sm"
          icon={
            pr.isDraft ? <GitPullRequestIcon size={12} /> : <GitPullRequestDraftIcon size={12} />
          }
          aria-label={`${draftName}: ${ref}`}
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
