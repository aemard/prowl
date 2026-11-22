import { useEffect, useState } from 'preact/hooks';
import { replyToThread, resolveThread } from '../../lib/github/threads';
import { countMessage, formatNumber, t } from '../../lib/i18n';
import type { PullRequest, ReviewThread } from '../../lib/model';
import { pendingActions, runPrAction } from '../state/prActions';
import { loadThreads, reviewThreads } from '../state/reviewThreads';
import { GitHubLink } from './GitHubLink';
import { AlertIcon } from './icons';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { TextField } from './ui/TextField';
import './ReviewThreads.css';

/**
 * One conversation: where it is, its last comments as text, a reply box and Resolve, both named
 * by the place they act on. A failed reply or resolve says why under the thread's buttons.
 */
function Thread({ pr, thread }: { pr: PullRequest; thread: ReviewThread }) {
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string>();
  const busy = pendingActions.value[pr.id] !== undefined;
  const where = thread.line ? `${thread.path}:${thread.line}` : thread.path;
  const last = thread.comments.at(-1);
  const earlier = thread.commentCount - thread.comments.length;
  const act = async (name: string, done: string, run: Parameters<typeof runPrAction>[3]) => {
    setError(undefined);
    if (await runPrAction(pr, name, done, run, setError)) {
      setReply('');
      void loadThreads(pr);
    }
  };
  return (
    <li class="review-thread">
      <p class="review-thread__where">
        <code>{where}</code>
        {thread.outdated && <Badge size="sm">{t('outdated')}</Badge>}
        {last && (
          <GitHubLink class="review-thread__link" href={last.url}>
            {t('viewInTheDiff')}
          </GitHubLink>
        )}
      </p>
      {earlier > 0 && (
        <p class="review-thread__earlier">{t('earlierComments', formatNumber(earlier))}</p>
      )}
      <ul class="review-thread__comments">
        {thread.comments.map((comment) => (
          <li key={comment.url}>
            <strong>{comment.author}</strong>{' '}
            <span class="review-thread__text">{comment.text}</span>
          </li>
        ))}
      </ul>
      {thread.canReply && (
        <TextField
          label={t('replyOn', where)}
          multiline
          rows={2}
          value={reply}
          onValueChange={(value) => {
            setReply(value);
            setError(undefined);
          }}
        />
      )}
      <div class="review-thread__actions">
        {thread.canReply && (
          <Button
            size="sm"
            aria-label={t('sendReplyOn', where)}
            disabled={busy || reply.trim() === ''}
            onClick={() =>
              void act(t('replyAction'), t('replied'), (c) => replyToThread(c, thread.id, reply))
            }
          >
            {t('replyAction')}
          </Button>
        )}
        {thread.canResolve && (
          <Button
            size="sm"
            aria-label={t('resolveConversationOn', where)}
            disabled={busy}
            onClick={() =>
              void act(t('resolveAction'), t('resolved'), (c) => resolveThread(c, thread.id))
            }
          >
            {t('resolveAction')}
          </Button>
        )}
      </div>
      {error && (
        <p class="review-thread__error" role="alert">
          <AlertIcon size={12} />
          <span>{error}</span>
        </p>
      )}
    </li>
  );
}

/**
 * The open review conversations of an expanded card, loaded when asked for: read the last
 * comments, reply or resolve without opening GitHub. Shown only when GitHub counts open ones;
 * read again when the pull request changes. When GitHub has more than Prowl reads, says so
 * rather than "none".
 */
export function ReviewThreads({ pr, id }: { pr: PullRequest; id: string }) {
  const entry = reviewThreads.value[pr.id];
  const stale = entry !== undefined && !entry.loading && entry.key !== pr.updatedAt;
  useEffect(() => {
    if (stale) void loadThreads(pr);
  }, [stale, pr.updatedAt]);
  if (pr.unresolvedThreads === 0 && !entry) return null;
  if (!entry?.threads && !entry?.error)
    return (
      <Button size="sm" loading={entry?.loading} onClick={() => void loadThreads(pr)}>
        {countMessage(pr.unresolvedThreads, 'showConversationsOne', 'showConversationsOther')}
      </Button>
    );
  return (
    <div class="review-threads">
      <p class="pr-detail__label" id={`${id}-threads`}>
        {t('conversations')}
      </p>
      {entry.error && (
        <p role="alert">
          {entry.error}{' '}
          <Button size="sm" loading={entry.loading} onClick={() => void loadThreads(pr)}>
            {t('tryAgain')}
          </Button>
        </p>
      )}
      {entry.threads?.length === 0 && entry.complete !== false && <p>{t('noOpenConversations')}</p>}
      {entry.threads && entry.threads.length > 0 && (
        <ul
          class="review-threads__list"
          aria-labelledby={`${id}-threads`}
          aria-busy={entry.loading}
        >
          {entry.threads.map((thread) => (
            <Thread key={thread.id} pr={pr} thread={thread} />
          ))}
        </ul>
      )}
      {entry.complete === false && (
        <p>
          {t('moreConversationsOnGitHub')}{' '}
          <GitHubLink href={pr.url}>{t('viewOnGitHub')}</GitHubLink>
        </p>
      )}
    </div>
  );
}
