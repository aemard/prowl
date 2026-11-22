import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { sendToBackground } from '../state/background';
import { loadDetail } from '../state/loadDetail';
import { detailKey, detailOf, details } from '../state/prDetail';
import { settings } from '../state/store';
import { Deployments } from './Deployments';
import { GitHubLink } from './GitHubLink';
import {
  AlertIcon,
  CheckIcon,
  DotFillIcon,
  GitMergeIcon,
  InfoIcon,
  SyncIcon,
  XIcon,
} from './icons';
import type { IconComponent } from './icons/Icon';
import { LocalAi } from './LocalAi';
import { MaintenanceActions } from './MaintenanceActions';
import { MergeAction } from './MergeAction';
import { type MergeLine, mergeReadiness } from './mergeReadiness';
import { Checks, Reviewers } from './PullRequestDetailLists';
import { ReviewActions } from './ReviewActions';
import { ReviewThreads } from './ReviewThreads';
import { Button } from './ui/Button';
import type { Tone } from './ui/cx';
import { Skeleton } from './ui/Skeleton';
import './PullRequestDetails.css';

const LINE_ICONS: Partial<Record<Tone, IconComponent>> = {
  success: CheckIcon,
  danger: XIcon,
  warning: AlertIcon,
  attention: DotFillIcon,
  done: GitMergeIcon,
};

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

function MergeLines({ lines, pr }: { lines: MergeLine[]; pr: PullRequest }) {
  return (
    <ul class="pr-detail__list" aria-label={t('mergeStatus')}>
      {lines.map(({ tone, text, link }) => {
        const Icon =
          text === t('autoMergeOnMergesWhenReady') ? SyncIcon : (LINE_ICONS[tone] ?? InfoIcon);
        return (
          <li class="pr-detail__row" key={text}>
            <span class="pr-detail__icon" data-tone={tone}>
              <Icon size={12} />
            </span>
            <span class="pr-detail__text">
              {text === t('checkingMergeStatus') ? <span role="status">{text}</span> : text}
              {link && (
                <>
                  {' '}
                  · <GitHubLink href={pr.url}>{link}</GitHubLink>
                </>
              )}
            </span>
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
 * data), the actions on it (review, comment, merge), then, once `ProwlPullRequestDetail` has
 * loaded, its checks (failed first, with links) and reviewers. Loads on mount and again when the
 * PR changes; a changed head or changed evidence shows a loading state until its detail is read.
 */
export function PullRequestDetails({ pr, id }: PullRequestDetailsProps) {
  const [refreshed, setRefreshed] = useState(false);
  const key = detailKey(pr);
  useEffect(() => {
    void loadDetail(pr);
    setRefreshed(false);
    let active = true;
    void sendToBackground({ type: 'refreshMergeState', prId: pr.id, headSha: pr.headSha }).finally(
      () => {
        if (active) setRefreshed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [key]);

  const entry = details.value[pr.id];
  const { detail } = detailOf(pr);
  const waiting = !detail && !entry?.error;
  return (
    <div id={id} class="pr-detail">
      <MergeLines lines={mergeReadiness(pr, detail, refreshed)} pr={pr} />
      {pr.incomplete?.length || detail?.warnings?.length ? (
        <p class="pr-detail__freshness" role="note">
          {t('someDetailsAreOnlyOnGitHub')}{' '}
          <GitHubLink href={pr.url}>{t('viewOnGitHub')}</GitHubLink>
        </p>
      ) : null}
      <fieldset class="pr-actions" aria-label={t('actionsFor2', String(pr.number))}>
        <MergeAction pr={pr} placement="merge" />
        <MaintenanceActions pr={pr} />
        <ReviewActions pr={pr} />
        <MergeAction pr={pr} placement="auto" />
        <GitHubLink class="pr-actions__link" href={`${pr.url}/files`}>
          {t('viewChangesOnGitHub')}
        </GitHubLink>
      </fieldset>
      {entry?.error && (
        <p class="pr-detail__error" role="alert">
          <AlertIcon size={16} />
          <span>{entry.error}</span>
          <Button size="sm" onClick={() => void loadDetail(pr)}>
            {t('tryAgain')}
          </Button>
        </p>
      )}
      {waiting && (
        <span class="sr-only" role="status">
          {t('loadingChecksAndReviewers')}
        </span>
      )}
      {(detail || waiting) && (
        <>
          <Group id={`${id}-checks`} label={t('checks')}>
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
          {settings.value.localAi && <LocalAi pr={pr} />}
          {detail?.deployments && (
            <Deployments deployments={detail.deployments} id={`${id}-deployments`} />
          )}
          <ReviewThreads pr={pr} id={id} />
          <Group id={`${id}-reviewers`} label={t('reviewers')}>
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
