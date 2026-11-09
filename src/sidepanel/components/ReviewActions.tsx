import type { Ref } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { approve, comment, MAX_BODY_LENGTH, requestChanges } from '../../lib/github/actions';
import type { GitHubClient } from '../../lib/github/client';
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { type ReviewDraftKind, reviewDrafts, setReviewDraft } from '../state/reviewDrafts';
import { auth } from '../state/store';
import { CheckIcon, CommentIcon, FileDiffIcon } from './icons';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { TextField } from './ui/TextField';

type Written = ReviewDraftKind;

/** The two actions that need words: what the dialog says and what is sent with them. */
const WRITTEN = {
  request_changes: {
    name: t('requestChanges'),
    done: t('requestedChangesOn'),
    description: (ref: string) => t('requestChangesDescription', ref),
    send: (client: GitHubClient, pr: PullRequest, text: string) =>
      requestChanges(client, pr.id, text, pr.headSha),
  },
  comment: {
    name: t('comment'),
    done: t('commentedOn'),
    description: (ref: string) => t('addACommentToTheConversationOf', ref),
    send: (client: GitHubClient, pr: PullRequest, text: string) => comment(client, pr.id, text),
  },
} as const;

const APPROVE = t('approve');

/**
 * Approve, request changes and comment, as buttons for the row of an expanded card's Actions.
 * Approving is one click (GitHub cannot take it back, so the toast does not offer to); the other
 * two open a dialog for the message. Reviewing your own pull request is refused by GitHub, so
 * those two buttons are hidden for the author, and for a PR that is no longer open. While one
 * action runs, its other buttons are disabled. A failed send keeps the dialog and text open,
 * with the error next to the field. Session drafts survive folding cards and switching views.
 */
export function ReviewActions({ pr }: { pr: PullRequest }) {
  const [writing, setWriting] = useState<Written | null>(null);
  const drafts = reviewDrafts.value[pr.id];
  const [error, setError] = useState('');
  const field = useRef<HTMLElement>(null);
  const viewer = auth.value?.viewer.login;
  if (!viewer) return null;

  const pending = pendingActions.value[pr.id];

  // An error that arrives after the click is only read out when its field has focus.
  const fail = (message: string) => {
    setError(message);
    field.current?.focus();
  };
  const open = (kind: Written) => {
    setError('');
    setWriting(kind);
  };
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && setWriting(null);
  const send = async (kind: Written) => {
    const { name, done, send: run } = WRITTEN[kind];
    const text = (drafts?.[kind] ?? '').trim();
    if (!text) return fail(t('writeAMessageFirst'));
    const sent = await runPrAction(pr, name, done, (client) => run(client, pr, text), fail);
    if (sent) {
      setWriting(null);
      setReviewDraft(pr.id, kind, '');
    }
  };

  return (
    <>
      <ReviewButtons pr={pr} viewer={viewer} pending={pending} open={open} />
      {writing && (
        <WrittenDialog
          pr={pr}
          writing={writing}
          pending={pending}
          draft={drafts?.[writing] ?? ''}
          inputRef={field}
          error={error}
          close={close}
          onSend={() => void send(writing)}
          onValueChange={(text) => {
            setError('');
            setReviewDraft(pr.id, writing, text);
          }}
        />
      )}
    </>
  );
}

function ReviewButtons({
  pr,
  viewer,
  pending,
  open,
}: {
  pr: PullRequest;
  viewer: string;
  pending: string | undefined;
  open: (kind: Written) => void;
}) {
  const ref = prRef(pr);
  const canReview = pr.state === 'open' && pr.author?.login.toLowerCase() !== viewer.toLowerCase();
  const state = (name: string) => ({
    loading: pending === name,
    disabled: pending !== undefined && pending !== name,
  });
  return (
    <>
      {canReview && (
        <Button
          size="sm"
          icon={<CheckIcon size={12} />}
          aria-label={t('message2', APPROVE, ref)}
          {...state(APPROVE)}
          onClick={() =>
            void runPrAction(pr, APPROVE, t('approved2'), (client) =>
              approve(client, pr.id, undefined, pr.headSha),
            )
          }
        >
          {APPROVE}
        </Button>
      )}
      {canReview && (
        <Button
          size="sm"
          icon={<FileDiffIcon size={12} />}
          aria-label={t('message2', WRITTEN.request_changes.name, ref)}
          {...state(WRITTEN.request_changes.name)}
          onClick={() => open('request_changes')}
        >
          {WRITTEN.request_changes.name}
        </Button>
      )}
      <Button
        size="sm"
        icon={<CommentIcon size={12} />}
        aria-label={t('on', WRITTEN.comment.name, ref)}
        {...state(WRITTEN.comment.name)}
        onClick={() => open('comment')}
      >
        {WRITTEN.comment.name}
      </Button>
    </>
  );
}

function WrittenDialog({
  pr,
  writing,
  pending,
  draft,
  inputRef,
  error,
  close,
  onSend,
  onValueChange,
}: {
  pr: PullRequest;
  writing: Written;
  pending: string | undefined;
  draft: string;
  inputRef: Ref<HTMLElement>;
  error: string;
  close: () => void;
  onSend: () => void;
  onValueChange: (text: string) => void;
}) {
  const written = WRITTEN[writing];
  const ref = prRef(pr);
  return (
    <Dialog
      open
      onClose={close}
      title={written.name}
      description={written.description(ref)}
      footer={
        <>
          <Button disabled={pending !== undefined} onClick={close}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={pending !== undefined} onClick={onSend}>
            {written.name}
          </Button>
        </>
      }
    >
      <TextField
        label={t('message3')}
        multiline
        rows={4}
        required
        maxLength={MAX_BODY_LENGTH}
        value={draft}
        inputRef={inputRef}
        error={error}
        readOnly={pending !== undefined}
        onValueChange={onValueChange}
      />
    </Dialog>
  );
}
