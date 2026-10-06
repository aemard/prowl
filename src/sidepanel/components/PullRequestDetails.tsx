import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import type { CheckItem, CheckItemState, PullRequest, Reviewer } from '../../lib/model';
import { detailKey, details, loadDetail } from '../state/prDetail';
import { GitHubLink } from './GitHubLink';
import {
  AlertIcon,
  CheckIcon,
  CommentIcon,
  DotFillIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  InfoIcon,
  SkipIcon,
  XIcon,
} from './icons';
import type { IconComponent } from './icons/Icon';
import { type MergeLine, mergeReadiness } from './mergeReadiness';
import { ReviewActions } from './ReviewActions';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { Tone } from './ui/cx';
import { Skeleton } from './ui/Skeleton';
import './PullRequestDetails.css';

interface Look {
  tone: Tone;
  Icon: IconComponent;
  label: string;
}

const CHECK_LOOK: Record<CheckItemState, Look> = {
  failed: { tone: 'danger', Icon: XIcon, label: 'Failed' },
  pending: { tone: 'attention', Icon: DotFillIcon, label: 'Pending' },
  passed: { tone: 'success', Icon: CheckIcon, label: 'Passed' },
  neutral: { tone: 'neutral', Icon: SkipIcon, label: 'Skipped' },
};

const REVIEWER_LOOK: Record<Reviewer['state'], Look> = {
  approved: { tone: 'success', Icon: CheckIcon, label: 'Approved' },
  changes_requested: { tone: 'danger', Icon: FileDiffIcon, label: 'Changes requested' },
  requested: { tone: 'attention', Icon: EyeIcon, label: 'Review requested' },
  commented: { tone: 'neutral', Icon: CommentIcon, label: 'Commented' },
  dismissed: { tone: 'neutral', Icon: SkipIcon, label: 'Dismissed' },
};

const LINE_ICONS: Partial<Record<Tone, IconComponent>> = {
  success: CheckIcon,
  danger: XIcon,
  warning: AlertIcon,
  attention: DotFillIcon,
  done: GitMergeIcon,
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A labelled block; the list inside it points at the label with `aria-labelledby={id}`. */
function Group({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div class="pr-detail__group">
      <p class="pr-detail__label" id={id}>
        {label}
      </p>
      {children}
    </div>
  );
}

function MergeLines({ lines, labelledBy }: { lines: MergeLine[]; labelledBy: string }) {
  return (
    <ul class="pr-detail__list" aria-labelledby={labelledBy}>
      {lines.map(({ tone, text }) => {
        const Icon = LINE_ICONS[tone] ?? InfoIcon;
        return (
          <li class="pr-detail__row" key={text}>
            <span class="pr-detail__icon" data-tone={tone}>
              <Icon size={12} />
            </span>
            <span class="pr-detail__text">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function CheckRow({ check }: { check: CheckItem }) {
  const { tone, Icon, label } = CHECK_LOOK[check.state];
  return (
    <li class="pr-detail__row">
      <span class="pr-detail__icon" data-tone={tone}>
        <Icon size={12} />
      </span>
      <span class="pr-detail__text" title={check.name}>
        {check.url ? <GitHubLink href={check.url}>{check.name}</GitHubLink> : check.name}
      </span>
      {check.required && (
        <Badge size="sm" tone="neutral" title="The base branch requires this check to pass">
          Required
        </Badge>
      )}
      <span class="pr-detail__state">{label}</span>
    </li>
  );
}

function Checks({
  pr,
  checks,
  total,
  labelledBy,
}: {
  pr: PullRequest;
  checks: CheckItem[];
  total: number;
  labelledBy: string;
}) {
  // What needs attention stays in view; the passed and skipped ones fold away.
  const open = checks.filter(({ state }) => state === 'failed' || state === 'pending');
  const done = checks.filter(({ state }) => state === 'passed' || state === 'neutral');
  const passed = done.filter(({ state }) => state === 'passed').length;
  const summary = [
    passed > 0 && `${passed} passed`,
    done.length > passed && `${done.length - passed} skipped`,
  ];
  return (
    <>
      {open.length > 0 && (
        <ul class="pr-detail__list" aria-labelledby={labelledBy}>
          {open.map((check) => (
            <CheckRow key={check.name} check={check} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details class="pr-detail__more">
          <summary>{summary.filter(Boolean).join(', ')}</summary>
          <ul class="pr-detail__list">
            {done.map((check) => (
              <CheckRow key={check.name} check={check} />
            ))}
          </ul>
        </details>
      )}
      {checks.length === 0 && (
        <p class="pr-detail__hint">
          {pr.checks.total > 0
            ? 'GitHub did not return the checks. A fine-grained token cannot read them.'
            : 'No checks on the latest commit.'}
        </p>
      )}
      {checks.length > 0 && checks.length < total && (
        <p class="pr-detail__hint">
          {plural(total - checks.length, 'more check')}{' '}
          <GitHubLink href={`${pr.url}/checks`}>on GitHub</GitHubLink>
        </p>
      )}
    </>
  );
}

function Reviewers({ reviewers, labelledBy }: { reviewers: Reviewer[]; labelledBy: string }) {
  if (reviewers.length === 0) return <p class="pr-detail__hint">No reviews yet.</p>;
  return (
    <ul class="pr-detail__list" aria-labelledby={labelledBy}>
      {reviewers.map(({ login, avatarUrl, state }) => {
        const { tone, Icon, label } = REVIEWER_LOOK[state];
        return (
          <li class="pr-detail__row" key={login}>
            <Avatar src={avatarUrl} />
            <span class="pr-detail__text" title={login}>
              {login}
            </span>
            <Badge tone={tone} icon={<Icon size={12} />}>
              {label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function DetailSkeleton() {
  return (
    <div class="pr-detail__skeleton" aria-hidden="true">
      <Skeleton width="70%" />
      <Skeleton width="55%" />
    </div>
  );
}

export interface PullRequestDetailsProps {
  pr: PullRequest;
  /** DOM id, which the card's expand button points at with `aria-controls`. */
  id: string;
}

/**
 * What an expanded card shows: why the PR can or cannot be merged (at once, from the list's own
 * data), the actions on it (review, comment), then, once `ProwlPullRequestDetail` has loaded, its
 * checks (failed first, with links) and reviewers. Loads on mount and again when the PR changes;
 * the last detail stays on screen while a newer one loads.
 */
export function PullRequestDetails({ pr, id }: PullRequestDetailsProps) {
  const key = detailKey(pr);
  useEffect(() => {
    void loadDetail(pr);
  }, [key]);

  const entry = details.value[pr.id];
  const detail = entry?.detail;
  const waiting = !detail && !entry?.error;
  return (
    <div id={id} class="pr-detail">
      <Group id={`${id}-merge`} label="Merge">
        <MergeLines lines={mergeReadiness(pr, detail)} labelledBy={`${id}-merge`} />
      </Group>
      <Group id={`${id}-actions`} label="Actions">
        {/* One row of small buttons; later actions (merge, re-run, draft) join it. */}
        <div class="pr-actions">
          <ReviewActions pr={pr} />
        </div>
      </Group>
      {entry?.error && (
        <p class="pr-detail__error" role="alert">
          <AlertIcon size={16} />
          <span>{entry.error}</span>
          <Button size="sm" onClick={() => void loadDetail(pr)}>
            Try again
          </Button>
        </p>
      )}
      {waiting && (
        <span class="sr-only" role="status">
          Loading checks and reviewers
        </span>
      )}
      {(detail || waiting) && (
        <>
          <Group id={`${id}-checks`} label="Checks">
            {detail ? (
              <Checks
                pr={pr}
                checks={detail.checks}
                total={detail.checksTotal}
                labelledBy={`${id}-checks`}
              />
            ) : (
              <DetailSkeleton />
            )}
          </Group>
          <Group id={`${id}-reviewers`} label="Reviewers">
            {detail ? (
              <Reviewers reviewers={detail.reviewers} labelledBy={`${id}-reviewers`} />
            ) : (
              <DetailSkeleton />
            )}
          </Group>
        </>
      )}
    </div>
  );
}
