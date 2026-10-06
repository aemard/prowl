import { useEffect, useId, useRef } from 'preact/hooks';
import type { PullRequest } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import { collapse, expandedIds, toggleExpanded } from '../state/prDetail';
import { GitHubLink } from './GitHubLink';
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CommentDiscussionIcon,
  CommentIcon,
  DotFillIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  XIcon,
} from './icons';
import type { IconComponent } from './icons/Icon';
import { labelColors } from './labelColor';
import { PullRequestDetails } from './PullRequestDetails';
import { describePullRequest, pullRequestStatuses, type StatusIcon } from './prStatus';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';
import './PullRequestCard.css';

const STATUS_ICONS: Record<StatusIcon, IconComponent> = {
  draft: GitPullRequestDraftIcon,
  check: CheckIcon,
  x: XIcon,
  dot: DotFillIcon,
  diff: FileDiffIcon,
  eye: EyeIcon,
  alert: AlertIcon,
  merge: GitMergeIcon,
};

/** Labels shown on a card; the rest collapse into "+N". */
const MAX_LABELS = 3;

export interface PullRequestCardProps {
  pr: PullRequest;
  /** Changed since the user last saw it. */
  unseen: boolean;
  /** `Date.now()` from the list's ticker, so relative times stay current. */
  now: number;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * One pull request in the list. The title is the link to GitHub; the chevron button (and a click
 * anywhere else on the card) expands it into its details, merge readiness first. The link and
 * the button are siblings, never nested, and each has its own name: the button says what it
 * opens and describes the card with every fact it shows, so a screen reader gets the whole card
 * in one stop. Chips pair color with an icon and a word; the unseen dot is also in the sentence.
 */
export function PullRequestCard({ pr, unseen, now }: PullRequestCardProps) {
  const detailId = useId();
  const card = useRef<HTMLLIElement>(null);
  const expanded = expandedIds.value.includes(pr.id);
  const statuses = pullRequestStatuses(pr);
  const labels = pr.labels.slice(0, MAX_LABELS);
  const hidden = pr.labels.slice(MAX_LABELS);

  // Two conveniences on top of the chevron button, which is the keyboard and screen reader path:
  // a click on the card's summary (not on a link or button, nor a selection made to copy text)
  // toggles it, and Escape folds an expanded card back and keeps focus on its button instead of
  // losing it with the detail that had it. Native listeners: the card itself is not a control.
  const id = pr.id;
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const onClick = ({ target }: MouseEvent) => {
      const summary = (target as Element).closest('.pr-card__summary');
      if (summary && !(target as Element).closest('a, button') && !getSelection()?.toString()) {
        toggleExpanded(id);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !expandedIds.value.includes(id))
        return;
      collapse(id);
      el.querySelector<HTMLElement>('.pr-card__toggle')?.focus();
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [id]);

  return (
    <li class="pr-card" ref={card}>
      <div class="pr-card__summary" data-pr-id={pr.id} data-unseen={unseen ? 'true' : undefined}>
        {unseen && <span class="pr-card__dot" title="Unseen changes" />}
        <span class="pr-card__head">
          <Avatar src={pr.author?.avatarUrl} title={pr.author?.login} />
          <span class="pr-card__repo" title={`${pr.repo.nameWithOwner}#${pr.number}`}>
            <span class="pr-card__repo-name">{pr.repo.nameWithOwner}</span>
            <span class="pr-card__number">#{pr.number}</span>
          </span>
          <time
            class="pr-card__updated"
            dateTime={pr.updatedAt}
            title={`Last activity ${new Date(pr.updatedAt).toLocaleString()}`}
          >
            {formatRelativeTime(pr.updatedAt, now)}
          </time>
          <IconButton
            class="pr-card__toggle"
            size="sm"
            label={`Details for ${pr.title}`}
            aria-expanded={expanded}
            aria-controls={expanded ? detailId : undefined}
            aria-describedby={`${detailId}-facts`}
            onClick={() => toggleExpanded(pr.id)}
          >
            {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </IconButton>
        </span>
        <GitHubLink
          class="pr-card__title"
          href={pr.url}
          title={pr.title}
          aria-label={`${pr.title}, ${pr.repo.nameWithOwner}#${pr.number}`}
        >
          {pr.title}
        </GitHubLink>
        {statuses.length > 0 && (
          <span class="pr-card__chips">
            {statuses.map(({ id, tone, icon, label, detail }) => {
              const Icon = STATUS_ICONS[icon];
              return (
                <Badge key={id} tone={tone} icon={<Icon size={12} />} title={detail}>
                  {label}
                </Badge>
              );
            })}
          </span>
        )}
        <span class="pr-card__meta">
          {pr.labels.length > 0 && (
            <span class="pr-card__labels">
              {labels.map(({ name, color }) => (
                <span class="pr-label" key={name} title={name} style={labelStyle(color)}>
                  {name}
                </span>
              ))}
              {hidden.length > 0 && (
                <span class="pr-label pr-label--more" title={hidden.map((l) => l.name).join(', ')}>
                  +{hidden.length}
                </span>
              )}
            </span>
          )}
          <span class="pr-card__foot">
            {pr.commentCount > 0 && (
              <span class="pr-card__stat" title={plural(pr.commentCount, 'comment')}>
                <CommentIcon size={12} />
                {pr.commentCount}
              </span>
            )}
            {pr.unresolvedThreads > 0 && (
              <span class="pr-card__stat" title={plural(pr.unresolvedThreads, 'unresolved thread')}>
                <CommentDiscussionIcon size={12} />
                {pr.unresolvedThreads} unresolved
              </span>
            )}
            <time
              class="pr-card__age"
              dateTime={pr.createdAt}
              title={`Opened ${new Date(pr.createdAt).toLocaleString()}`}
            >
              Opened {formatRelativeTime(pr.createdAt, now)}
            </time>
          </span>
        </span>
        <span id={`${detailId}-facts`} hidden>
          {describePullRequest(pr, statuses, unseen, now)}
        </span>
      </div>
      {expanded && <PullRequestDetails pr={pr} id={detailId} />}
    </li>
  );
}

function labelStyle(color: string) {
  const { background, color: text } = labelColors(color);
  return { '--label-bg': background, '--label-fg': text };
}
