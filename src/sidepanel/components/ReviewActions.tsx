import { useState } from 'preact/hooks';
import { approve, comment, MAX_BODY_LENGTH, requestChanges } from '../../lib/github/actions';
import type { GitHubClient } from '../../lib/github/client';
import type { PullRequest } from '../../lib/model';
import { pendingActions, prRef, runPrAction } from '../state/prActions';
import { auth } from '../state/store';
import { CheckIcon, CommentIcon, FileDiffIcon } from './icons';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { TextField } from './ui/TextField';

type Written = 'request_changes' | 'comment';

/** The two actions that need words: what the dialog says and what is sent with them. */
const WRITTEN = {
  request_changes: {
    name: 'Request changes',
    done: 'Requested changes on',
    description: (ref: string) => `Tell the author what has to change in ${ref}.`,
    send: (client: GitHubClient, pr: PullRequest, text: string) =>
      requestChanges(client, pr.id, text, pr.headSha),
  },
  comment: {
    name: 'Comment',
    done: 'Commented on',
    description: (ref: string) => `Add a comment to the conversation of ${ref}.`,
    send: (client: GitHubClient, pr: PullRequest, text: string) => comment(client, pr.id, text),
  },
} as const;

const APPROVE = 'Approve';

/**
 * Approve, request changes and comment, as buttons for the row of an expanded card's Actions.
 * Approving is one click (GitHub cannot take it back, so the toast does not offer to); the other
 * two open a dialog for the message. Reviewing your own pull request is refused by GitHub, so
 * those two buttons are hidden for the author, and for a PR that is no longer open. While one
 * action of the PR runs, its other buttons are disabled; a failure closes the dialog, shows
 * GitHub's reason in a toast (a modal would hide it) and keeps what was written for the next try.
 */
export function ReviewActions({ pr }: { pr: PullRequest }) {
  const [writing, setWriting] = useState<Written | null>(null);
  const [drafts, setDrafts] = useState({ request_changes: '', comment: '' });
  const [error, setError] = useState('');
  const viewer = auth.value?.viewer.login;
  if (!viewer) return null;

  const pending = pendingActions.value[pr.id];

  const open = (kind: Written) => {
    setError('');
    setWriting(kind);
  };
  // What is being sent cannot be taken back by closing the dialog.
  const close = () => pending === undefined && setWriting(null);
  const send = async (kind: Written) => {
    const { name, done, send: run } = WRITTEN[kind];
    const text = drafts[kind].trim();
    if (!text) return setError('Write a message first.');
    const sent = await runPrAction(pr, name, done, (client) => run(client, pr, text));
    setWriting(null);
    if (sent) setDrafts((all) => ({ ...all, [kind]: '' }));
  };

  return (
    <>
      <ReviewButtons pr={pr} viewer={viewer} pending={pending} open={open} />
      {writing && (
        <WrittenDialog
          pr={pr}
          writing={writing}
          pending={pending}
          draft={drafts[writing]}
          error={error}
          close={close}
          onSend={() => void send(writing)}
          onValueChange={(text) => {
            setError('');
            setDrafts((all) => ({ ...all, [writing]: text }));
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
          aria-label={`${APPROVE} ${ref}`}
          {...state(APPROVE)}
          onClick={() =>
            void runPrAction(pr, APPROVE, 'Approved', (client) =>
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
          aria-label={`${WRITTEN.request_changes.name} ${ref}`}
          {...state(WRITTEN.request_changes.name)}
          onClick={() => open('request_changes')}
        >
          {WRITTEN.request_changes.name}
        </Button>
      )}
      <Button
        size="sm"
        icon={<CommentIcon size={12} />}
        aria-label={`${WRITTEN.comment.name} on ${ref}`}
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
  error,
  close,
  onSend,
  onValueChange,
}: {
  pr: PullRequest;
  writing: Written;
  pending: string | undefined;
  draft: string;
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
            Cancel
          </Button>
          <Button variant="primary" loading={pending !== undefined} onClick={onSend}>
            {written.name}
          </Button>
        </>
      }
    >
      <TextField
        label="Message"
        multiline
        rows={4}
        required
        maxLength={MAX_BODY_LENGTH}
        value={draft}
        error={error}
        readOnly={pending !== undefined}
        onValueChange={onValueChange}
      />
    </Dialog>
  );
}
