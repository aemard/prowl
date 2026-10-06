import type { PullRequest } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import { isGitHubUrl, openGitHubUrl } from '../openUrl';
import {
  AlertIcon,
  CheckIcon,
  CommentDiscussionIcon,
  CommentIcon,
  DotFillIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  PersonIcon,
  XIcon,
} from './icons';
import type { IconComponent } from './icons/Icon';
import { labelColors } from './labelColor';
import { describePullRequest, pullRequestStatuses, type StatusIcon } from './prStatus';
import { Badge } from './ui/Badge';
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
 * One pull request in the list: a single link to GitHub whose accessible name is the title plus
 * everything the card shows, so it is one stop for a screen reader. Chips pair color with an
 * icon and a word; the unseen dot is also in the name.
 */
export function PullRequestCard({ pr, unseen, now }: PullRequestCardProps) {
  const statuses = pullRequestStatuses(pr);
  const labels = pr.labels.slice(0, MAX_LABELS);
  const hidden = pr.labels.slice(MAX_LABELS);
  return (
    <li class="pr-card" data-pr-id={pr.id} data-unseen={unseen ? 'true' : undefined}>
      <a
        class="pr-card__link"
        href={isGitHubUrl(pr.url) ? pr.url : undefined}
        aria-label={describePullRequest(pr, statuses, unseen, now)}
        onClick={(event) => {
          event.preventDefault();
          void openGitHubUrl(pr.url);
        }}
      >
        {unseen && <span class="pr-card__dot" title="Unseen changes" />}
        <span class="pr-card__head">
          {pr.author ? (
            <img
              class="pr-card__avatar"
              src={pr.author.avatarUrl}
              alt=""
              title={pr.author.login}
              width="20"
              height="20"
              decoding="async"
            />
          ) : (
            <span class="pr-card__avatar" aria-hidden="true">
              <PersonIcon size={12} />
            </span>
          )}
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
        </span>
        <span class="pr-card__title" title={pr.title}>
          {pr.title}
        </span>
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
      </a>
    </li>
  );
}

function labelStyle(color: string) {
  const { background, color: text } = labelColors(color);
  return { '--label-bg': background, '--label-fg': text };
}
