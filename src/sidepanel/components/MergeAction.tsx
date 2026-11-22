import { setAutoMerge } from '../../lib/github/mergeActions';
import { t } from '../../lib/i18n';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { detailOf } from '../state/prDetail';
import { auth } from '../state/store';
import { GitHubLink } from './GitHubLink';
import { GitMergeIcon } from './icons';
import { MergeDialog, type MergeDialogProps, useMergeControls } from './MergeDialog';
import { MergeQueueAction } from './MergeQueueAction';
import { type MergePlacement, mergeOptions } from './mergeReadiness';
import { Button } from './ui/Button';
import './MergeAction.css';

/**
 * Merging an open, non-draft PR the viewer can merge, in one of two places of the actions row:
 * Merge before the review actions, auto-merge after them (`placement`). Nothing shows until the
 * card's detail says whether the base branch merges through a merge queue: a direct Merge there
 * is one GitHub refuses. With a queue, `MergeQueueAction` takes over; when the detail cannot be
 * read, a link to merge on GitHub stands in.
 */
export function MergeAction({
  pr,
  placement = 'all',
}: {
  pr: PullRequest;
  placement?: MergePlacement;
}) {
  const { detail, failed } = detailOf(pr);
  if (!auth.value || !pr.viewerCanMerge || pr.state !== 'open' || pr.isDraft) return null;
  if (!detail)
    return failed && placement !== 'auto' ? (
      <GitHubLink href={pr.url}>{t('mergeOnGitHub')}</GitHubLink>
    ) : null;
  const methods = detail.allowedMergeMethods ?? pr.allowedMergeMethods;
  return (
    <>
      {detail.mergeQueue !== undefined ? (
        <MergeQueueAction
          pr={pr}
          queue={detail.mergeQueue}
          placement={placement}
          method={pick(methods, pr.defaultMergeMethod)}
        />
      ) : methods.length > 0 ? (
        <DirectMerge pr={pr} detail={detail} methods={methods} placement={placement} />
      ) : (
        placement !== 'auto' && <GitHubLink href={pr.url}>{t('mergeOnGitHub')}</GitHubLink>
      )}
      {placement !== 'merge' && <TurnOffAutoMerge pr={pr} />}
    </>
  );
}

/** The first of `preferred` that `methods` allows, else the first allowed one. */
const pick = (methods: MergeMethod[], ...preferred: (MergeMethod | undefined)[]) =>
  [...preferred, ...methods].find((m): m is MergeMethod => m !== undefined && methods.includes(m));

/** Merge (or "Merge without waiting", or "Enable auto-merge") and its confirmation. */
function DirectMerge({
  pr,
  detail,
  methods,
  placement,
}: Omit<MergeDialogProps, 'method' | 'controls'>) {
  const controls = useMergeControls(pr, detail);
  const method = pick(methods, controls.picked, pr.defaultMergeMethod);
  const { pending, setConfirming } = controls;
  const { ready, canMerge, offerAutoMerge } = mergeOptions(pr, placement);
  if (!method || (!canMerge && !offerAutoMerge)) return null;
  const action = canMerge ? t('merge') : t('enableAutoMerge');
  const label = canMerge ? (ready ? t('merge') : t('mergeWithoutWaiting')) : action;
  return (
    <>
      <Button
        size="sm"
        variant={ready ? 'primary' : 'secondary'}
        icon={<GitMergeIcon size={12} />}
        aria-label={t('message2', label, prRef(pr))}
        loading={pending === action}
        disabled={pending !== undefined && pending !== action}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
      {controls.confirming && (
        <MergeDialog
          pr={pr}
          detail={detail}
          methods={methods}
          method={method}
          controls={controls}
          placement={placement}
        />
      )}
    </>
  );
}

/** "Turn off auto-merge" while it is on and the viewer may turn it off, with or without a queue. */
function TurnOffAutoMerge({ pr }: { pr: PullRequest }) {
  const pending = pendingActions.value[pr.id];
  if (!pr.autoMerge || pr.viewerCanDisableAutoMerge !== true) return null;
  return (
    <Button
      size="sm"
      aria-label={t('of', t('turnOffAutoMerge'), prRef(pr))}
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
  );
}
