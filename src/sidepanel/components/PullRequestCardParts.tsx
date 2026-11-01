import { formatRelativeTime } from '../../lib/time/relative';
import { formatSnoozeEnd } from '../../lib/time/snooze';
import { toggleExpanded } from '../state/prDetail';
import { auth } from '../state/store';
import {
  AlertIcon,
  BellSlashIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CommentDiscussionIcon,
  CommentIcon,
  DotFillIcon,
  EyeClosedIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  PeopleIcon,
  SyncIcon,
  XIcon,
} from './icons';
import type { IconComponent } from './icons/Icon';
import { PrMenu } from './PrMenu';
import type { PullRequestCardProps } from './PullRequestCard';
import type { pullRequestStatuses, StatusIcon } from './prStatus';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';

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

type CardHeadProps = Pick<
  PullRequestCardProps,
  'pr' | 'now' | 'muted' | 'snoozedUntil' | 'grouped'
> & { expanded: boolean; detailId: string };
type Statuses = ReturnType<typeof pullRequestStatuses>;
const MAX_LABELS = 3;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function CardHead({
  pr,
  now,
  muted,
  snoozedUntil,
  grouped,
  expanded,
  detailId,
}: CardHeadProps) {
  return (
    <span class="pr-card__head">
      <Avatar src={pr.author?.avatarUrl} title={pr.author?.login} />
      <span class="pr-card__repo" title={`${pr.repo.nameWithOwner}#${pr.number}`}>
        {!grouped && <span class="pr-card__repo-name">{pr.repo.nameWithOwner}</span>}
        <span class="pr-card__number">#{pr.number}</span>
      </span>
      <time
        class="pr-card__updated"
        dateTime={pr.updatedAt}
        title={`Last activity ${new Date(pr.updatedAt).toLocaleString()}`}
      >
        {formatRelativeTime(pr.updatedAt, now)}
      </time>
      <CardFlags muted={muted} snoozedUntil={snoozedUntil} now={now} />
      <PrMenu pr={pr} now={now} />
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
  );
}

function CardFlags({
  muted,
  snoozedUntil,
  now,
}: Pick<PullRequestCardProps, 'muted' | 'snoozedUntil' | 'now'>) {
  return (
    <>
      {muted && (
        <span class="pr-card__flag" title="Notifications muted">
          <BellSlashIcon size={12} />
          <span class="sr-only">Notifications muted</span>
        </span>
      )}
      {snoozedUntil && (
        <span
          class="pr-card__flag"
          title={`Snoozed until ${new Date(snoozedUntil).toLocaleString()}`}
        >
          <ClockIcon size={12} />
          {formatSnoozeEnd(snoozedUntil, now)}
        </span>
      )}
    </>
  );
}

export function CardChips({
  statuses,
  refreshingMerge,
  hiddenBecause,
  teams,
  teamRequest,
}: {
  statuses: Statuses;
  refreshingMerge: boolean;
  hiddenBecause?: string;
  teams?: readonly string[];
  teamRequest: string | false | undefined;
}) {
  if (!refreshingMerge && !hiddenBecause && !teamRequest && statuses.length === 0) return null;
  return (
    <span class="pr-card__chips">
      {refreshingMerge && (
        <Badge
          variant="plain"
          icon={<SyncIcon size={12} />}
          title="Checking the latest merge status on GitHub"
        >
          Updating merge status
        </Badge>
      )}
      {hiddenBecause && (
        <Badge
          variant="plain"
          icon={<EyeClosedIcon size={12} />}
          title="Why it is hidden from the list"
        >
          {hiddenBecause}
        </Badge>
      )}
      {teamRequest && (
        <Badge variant="plain" icon={<PeopleIcon size={12} />} title={teamRequest}>
          {teams?.map((t) => `@${t}`).join(', ')}
        </Badge>
      )}
      <StatusBadges statuses={statuses} />
    </span>
  );
}

function StatusBadges({ statuses }: { statuses: Statuses }) {
  return (
    <>
      {statuses.map(({ id, tone, icon, label, detail }) => {
        const Icon = STATUS_ICONS[icon];
        return (
          <Badge key={id} tone={tone} variant="plain" icon={<Icon size={12} />} title={detail}>
            {label}
          </Badge>
        );
      })}
    </>
  );
}

export function CardMeta({ pr, now }: Pick<PullRequestCardProps, 'pr' | 'now'>) {
  return (
    <span class="pr-card__meta">
      <CardLabels pr={pr} />
      <CardFooter pr={pr} now={now} />
    </span>
  );
}

function CardLabels({ pr }: Pick<PullRequestCardProps, 'pr'>) {
  const labels = pr.labels.slice(0, MAX_LABELS);
  const hidden = pr.labels.slice(MAX_LABELS);
  return (
    <>
      {pr.labels.length > 0 && (
        <span class="pr-card__labels">
          {labels.map(({ name, color }) => (
            <span class="pr-label" key={name} title={name} style={{ '--label-color': `#${color}` }}>
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
    </>
  );
}

function CardFooter({ pr, now }: Pick<PullRequestCardProps, 'pr' | 'now'>) {
  // Who opened it, in words: the avatar alone is a 16 px picture with a tooltip. Not for your own.
  const author = pr.author?.login;
  const by =
    author && author.toLowerCase() !== auth.value?.viewer.login.toLowerCase() ? author : null;
  return (
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
      <span class="pr-card__age" title={by ? `Opened by ${by}` : undefined}>
        <time dateTime={pr.createdAt} title={`Opened ${new Date(pr.createdAt).toLocaleString()}`}>
          Opened {formatRelativeTime(pr.createdAt, now)}
        </time>
        {by && ` by ${by}`}
      </span>
    </span>
  );
}
