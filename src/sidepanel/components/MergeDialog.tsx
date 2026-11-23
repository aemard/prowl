import { useEffect, useState } from 'preact/hooks';
import { formatNumber, t } from '../../lib/i18n';
import { isReadyToMerge } from '../../lib/mergeEligibility';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { sendToBackground } from '../state/background';
import { loadDetail, mergeDetailOf } from '../state/loadDetail';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { detailKey } from '../state/prDetail';
import { GitHubLink } from './GitHubLink';
import { AlertIcon } from './icons';
import { mergeReadiness } from './mergeReadiness';
import {
  type MergePlacement,
  type MergePlan,
  type MergeTarget,
  type MergeVerb,
  mergePlan,
  sendMerge,
} from './mergeTarget';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';
import { TextField } from './ui/TextField';
import './MergeDialog.css';

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

/** The heads the dialog lists, to tell whether one moved since it opened. */
const heads = (members: PullRequest[]) => members.map((pr) => `${pr.id}@${pr.headSha}`).join(' ');

export interface MergeDialogProps {
  target: MergeTarget;
  placement?: MergePlacement;
  onClose: () => void;
}

/**
 * The dialog's state, which a poll does not reset (it reads `mergeDetailOf`). A commit title the
 * user edited belongs to the method it was written for: switching the method shows that method's
 * own title (GitHub's, or the user's earlier edit of it), and switching back restores the edit.
 * GitHub pins only the top's head, so a send refuses once when a listed head (or the stack's run)
 * changed since the dialog opened, and asks to confirm the list again.
 */
function useMergeDialog({ target, placement, onClose }: MergeDialogProps) {
  const { pr, stack } = target;
  const members = stack?.members ?? [pr];
  const [seen, setSeen] = useState(() => heads(members));
  const [picked, setPicked] = useState<MergeMethod>();
  const [edited, setEdited] = useState<Partial<Record<MergeMethod, string>>>({});
  const [error, setError] = useState<string>();
  // The list's stack Merge opens before any card read the top's detail.
  useEffect(() => void loadDetail(pr), [detailKey(pr)]);
  const { detail, failed } = mergeDetailOf(pr);
  const plan = mergePlan(target, detail, placement, picked);
  const pending = pendingActions.value[pr.id];
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && onClose();
  const send = async (verb: MergeVerb) => {
    setError(undefined);
    if (heads(members) !== seen) {
      setSeen(heads(members));
      return setError(t('stackChangedSinceOpened'));
    }
    const { method = 'merge' } = plan;
    // `sendMerge` says what GitHub did; untouched, the title is GitHub's, as the field showed.
    const sent = await runPrAction(
      pr,
      plan.name(verb),
      '',
      (client) => sendMerge(client, target, verb, method, edited[method]),
      setError,
    );
    // A refusal often means the copy is stale (the head moved): ask for a fresh one.
    if (sent) onClose();
    else void sendToBackground({ type: 'poll', reason: 'change' });
  };
  // GitHub's own title unless the user edited it (`PullRequestDetail.commitTitles`).
  const titleOf = (method: MergeMethod) =>
    edited[method] ??
    detail?.commitTitles?.[method === 'merge' ? 'merge' : 'squash'] ??
    `${pr.title} (#${pr.number})`;
  const setTitle = (method: MergeMethod, title: string) =>
    setEdited((all) => ({ ...all, [method]: title }));
  return { detail, failed, plan, pending, error, close, send, setPicked, titleOf, setTitle };
}

type MergeDialogState = ReturnType<typeof useMergeDialog>;

/**
 * Confirms any merge (`MergeTarget`): a lone PR now, with auto-merge or through its branch's
 * merge queue, or a stack's ready run. It says what merges where, what still blocks it, and asks
 * for the method and commit title where GitHub takes them. Failures stay in the dialog; it
 * cannot be dismissed while the merge is sent.
 */
export function MergeDialog(props: MergeDialogProps) {
  const state = useMergeDialog(props);
  const { pr, stack } = props.target;
  return (
    <Dialog
      open
      onClose={state.close}
      {...copy(props.target, state.plan)}
      error={state.error}
      footer={<MergeFooter state={state} stack={stack !== undefined} />}
    >
      {stack ? (
        <StackRun pr={pr} members={stack.members} open={stack.open} state={state} />
      ) : (
        <LoneSummary pr={pr} state={state} />
      )}
      <MethodFields state={state} titled={!stack && !state.plan.queue} />
    </Dialog>
  );
}

/** The dialog's title, and what merges where. */
function copy({ pr, stack }: MergeTarget, plan: MergePlan) {
  const ref = prRef(pr);
  const into = pr.baseRefName;
  const { verbs } = plan;
  if (stack) {
    const number = formatNumber(pr.stack?.number ?? 0);
    const description = t('stackMergeDescription', number, pr.repo.nameWithOwner, base(pr));
    return { title: plan.name('merge'), description };
  }
  if (plan.queue) {
    const verb = verbs[0] ?? 'enqueue';
    const key = verb === 'enqueue' ? 'addToMergeQueueDescription' : 'mergeWhenReadyDescription';
    return { title: plan.name(verb), description: t(key, ref, into) };
  }
  const key = !verbs.includes('merge')
    ? 'letGitHubMergeIntoOnceItsChecksAndReviewsPass'
    : verbs.includes('auto')
      ? 'mergeIntoNowOrLetGithubMergeItOnce'
      : 'mergeInto';
  return { title: t('mergePullRequest'), description: t(key, ref, into) };
}

const base = (pr: PullRequest) => pr.stack?.base ?? pr.baseRefName;

/** A lone PR: whether the rules are bypassed, its title, and the blockers the modal hides. */
function LoneSummary({ pr, state }: { pr: PullRequest; state: MergeDialogState }) {
  const { detail, plan } = state;
  const ready = isReadyToMerge(pr);
  const blockers = ready
    ? []
    : mergeReadiness(pr, detail)
        .filter(({ tone }) => tone !== 'neutral' && tone !== 'success')
        .map(({ text }) => text.replace(/^Blocked: /, ''))
        .map((text) => text.charAt(0).toLowerCase() + text.slice(1));
  return (
    <>
      {plan.verbs.includes('merge') && !ready && (
        <p>{t('youCanBypassTheBranchRulesForThisPullRequest')}</p>
      )}
      <p class="merge-dialog__pr">{pr.title}</p>
      {blockers.length > 0 && (
        <p class="merge-dialog__blockers">
          <AlertIcon size={12} />
          <span>{t('notReadyReasons', blockers.join('; '))}</span>
        </p>
      )}
    </>
  );
}

/** A stack's run in merge order, what stays open, and how it merges (or why not from here). */
function StackRun({
  pr,
  members,
  open,
  state,
}: {
  pr: PullRequest;
  members: PullRequest[];
  open: number;
  state: MergeDialogState;
}) {
  const { detail, failed, plan } = state;
  return (
    <>
      <ol class="merge-dialog__run">
        {members.map((member) => (
          <li key={member.id}>
            <span class="merge-dialog__position">{formatNumber(member.stack?.position ?? 0)}</span>
            <span class="merge-dialog__ref">{prRef(member)}</span> {member.title}
          </li>
        ))}
      </ol>
      {members.length < open && (
        <p class="merge-dialog__rest">
          {t('stackMergeRest', formatNumber(open - members.length), base(pr))}
        </p>
      )}
      {!detail && !failed ? (
        <p role="status">{t('stackMergeChecking', base(pr))}</p>
      ) : plan.verbs.length === 0 ? (
        <p>
          {t('stackMergeUnknown', base(pr))}{' '}
          <GitHubLink href={pr.url}>{t('mergeOnGitHub')}</GitHubLink>
        </p>
      ) : (
        plan.queue && <p>{t('stackMergeQueued', base(pr))}</p>
      )}
    </>
  );
}

/** The method where GitHub lets it be chosen, and the commit title of a lone direct merge. */
function MethodFields({ state, titled }: { state: MergeDialogState; titled: boolean }) {
  const { plan, pending, setPicked, titleOf, setTitle } = state;
  const { method, methods } = plan;
  if (!method || plan.queue || plan.verbs.length === 0) return null;
  return (
    <>
      {methods.length > 1 && (
        <Select
          label={t('mergeMethod')}
          value={method}
          options={methods.map((value) => ({ value, label: METHODS[value] }))}
          disabled={pending !== undefined}
          onValueChange={setPicked}
        />
      )}
      {titled && method !== 'rebase' && (
        <TextField
          label={t('commitTitle')}
          value={titleOf(method)}
          readOnly={pending !== undefined}
          onValueChange={(title) => setTitle(method, title)}
        />
      )}
    </>
  );
}

/** Cancel, then one button per verb, the first emphasized; a stack's waits for its detail. */
function MergeFooter({ state, stack }: { state: MergeDialogState; stack: boolean }) {
  const { plan, pending, close, send } = state;
  const { verbs, method, methods } = plan;
  const shown: MergeVerb[] = verbs.length > 0 || !stack ? verbs : ['merge'];
  return (
    <>
      <Button disabled={pending !== undefined} onClick={close}>
        {t('cancel')}
      </Button>
      {shown.map((verb, index) => {
        const name = plan.name(verb);
        return (
          <Button
            key={verb}
            variant={index === 0 ? 'primary' : 'secondary'}
            loading={pending === name}
            disabled={!verbs.includes(verb) || (pending !== undefined && pending !== name)}
            onClick={() => void send(verb)}
          >
            {verb === 'merge' && !stack && method && methods.length === 1 ? METHODS[method] : name}
          </Button>
        );
      })}
    </>
  );
}
