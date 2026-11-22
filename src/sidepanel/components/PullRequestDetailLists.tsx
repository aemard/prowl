/** The checks and reviewers lists of an expanded card (`PullRequestDetails`). */
import { countMessage, t } from '../../lib/i18n';
import type { CheckItem, CheckItemState, PullRequest, Reviewer } from '../../lib/model';
import { GitHubLink } from './GitHubLink';
import {
  CheckIcon,
  CommentIcon,
  DotFillIcon,
  EyeIcon,
  FileDiffIcon,
  SkipIcon,
  XIcon,
} from './icons';
import type { IconComponent } from './icons/Icon';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import type { Tone } from './ui/cx';

interface Look {
  tone: Tone;
  Icon: IconComponent;
  label: string;
}

const CHECK_LOOK: Record<CheckItemState, Look> = {
  failed: { tone: 'danger', Icon: XIcon, label: t('failed') },
  pending: { tone: 'attention', Icon: DotFillIcon, label: t('pending') },
  passed: { tone: 'success', Icon: CheckIcon, label: t('passed') },
  neutral: { tone: 'neutral', Icon: SkipIcon, label: t('skipped') },
};

const REVIEWER_LOOK: Record<Reviewer['state'], Look> = {
  approved: { tone: 'success', Icon: CheckIcon, label: t('approved2') },
  changes_requested: { tone: 'danger', Icon: FileDiffIcon, label: t('changesRequested2') },
  requested: { tone: 'attention', Icon: EyeIcon, label: t('reviewRequested') },
  commented: { tone: 'neutral', Icon: CommentIcon, label: t('commented2') },
  dismissed: { tone: 'neutral', Icon: SkipIcon, label: t('dismissed') },
};

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
        <Badge size="sm" tone="neutral" title={t('theBaseBranchRequiresThisCheckToPass')}>
          {t('required')}
        </Badge>
      )}
      <span class="pr-detail__state">{label}</span>
    </li>
  );
}

export function Checks({
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
    passed > 0 && t('passed2', passed),
    done.length > passed && t('skipped2', done.length - passed),
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
          {pr.checks.total > 0 ? (
            <>
              {t('thisTokenCanTReadChecks')}{' '}
              <GitHubLink href={`${pr.url}/checks`}>{t('viewOnGitHub')}</GitHubLink>
            </>
          ) : (
            t('noChecksOnTheLatestCommit')
          )}
        </p>
      )}
      {checks.length > 0 && checks.length < total && (
        <p class="pr-detail__hint">
          {countMessage(total - checks.length, 'moreCheckCountOne', 'moreCheckCountOther')}{' '}
          <GitHubLink href={`${pr.url}/checks`}>{t('onGithub')}</GitHubLink>
        </p>
      )}
    </>
  );
}

export function Reviewers({
  reviewers,
  labelledBy,
}: {
  reviewers: Reviewer[];
  labelledBy: string;
}) {
  if (reviewers.length === 0) return <p class="pr-detail__hint">{t('noReviewsYet')}</p>;
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
            <Badge tone={tone} variant="plain" icon={<Icon size={12} />}>
              {label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
