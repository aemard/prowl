import { useEffect, useId, useRef } from 'preact/hooks';
import type { PullRequest } from '../../lib/model';
import { collapse, expandedIds, toggleExpanded } from '../state/prDetail';
import { pollState } from '../state/store';
import { GitHubLink } from './GitHubLink';
import { lazy } from './lazy';
import { CardChips, CardHead, CardMeta } from './PullRequestCardParts';
import { describePullRequest, pullRequestStatuses } from './prStatus';
import './PullRequestCard.css';

/** The expanded part (checks, reviewers, actions, dialogs) loads with the first expand. */
const PullRequestDetails = lazy(
  () => import('./PullRequestDetails').then((m) => m.PullRequestDetails),
  // Same id, so the expand button's aria-controls points at it while the chunk loads.
  ({ id }) => <div id={id} class="pr-detail" aria-busy="true" />,
);

export interface PullRequestCardProps {
  pr: PullRequest;
  /** Changed since the user last saw it. */
  unseen: boolean;
  /** `Date.now()` from the list's ticker, so relative times stay current. */
  now: number;
  /** Notifications are off for this PR (local only). */
  muted?: boolean;
  /** ISO time the snooze ends, when the PR is snoozed. */
  snoozedUntil?: string | null;
  /** Why the list hides this PR ("No commit for 34 d"), on a card shown with the hidden ones. */
  hiddenBecause?: string;
  /** The card sits under its repository's header, so its own row shows only `#number`. */
  grouped?: boolean;
  /** The viewer's teams (`org/slug`) asked to review it, from `snapshot.teamRequests`. */
  teams?: readonly string[];
}

function useCardInteractions(id: string) {
  const card = useRef<HTMLLIElement>(null);
  // Two conveniences on top of the chevron button, which is the keyboard and screen reader path:
  // a click on the card's summary (not on a link or button, nor a selection made to copy text)
  // toggles it, and Escape folds an expanded card back and keeps focus on its button instead of
  // losing it with the detail that had it. Native listeners: the card itself is not a control.
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

  return card;
}

/**
 * One pull request in the list. The title links to GitHub; its sibling chevron (and a click
 * elsewhere on the summary) expands details. The chevron's accessible description includes
 * every fact on the card, including unseen changes, so screen readers get them in one stop.
 */
export function PullRequestCard({
  pr,
  unseen,
  now,
  muted,
  snoozedUntil,
  hiddenBecause,
  grouped,
  teams,
}: PullRequestCardProps) {
  const detailId = useId();
  const card = useCardInteractions(pr.id);
  const expanded = expandedIds.value.includes(pr.id);
  const statuses = pullRequestStatuses(pr);
  const refreshingMerge = pollState.value?.mergePending?.includes(pr.id) === true;
  const teamRequest =
    teams && teams.length > 0 && `Review requested from ${teams.map((t) => `@${t}`).join(', ')}`;

  return (
    <li class="pr-card" ref={card}>
      <div class="pr-card__summary" data-pr-id={pr.id} data-unseen={unseen ? 'true' : undefined}>
        {unseen && <span class="pr-card__dot" title="Unseen changes" />}
        <CardHead
          pr={pr}
          now={now}
          muted={muted}
          snoozedUntil={snoozedUntil}
          grouped={grouped}
          expanded={expanded}
          detailId={detailId}
        />
        <GitHubLink
          class="pr-card__title"
          href={pr.url}
          title={pr.title}
          aria-label={`${pr.title}, ${pr.repo.nameWithOwner}#${pr.number}`}
        >
          {pr.title}
        </GitHubLink>
        <CardChips
          statuses={statuses}
          refreshingMerge={refreshingMerge}
          hiddenBecause={hiddenBecause}
          teams={teams}
          teamRequest={teamRequest}
        />
        <CardMeta pr={pr} now={now} />
        <span id={`${detailId}-facts`} hidden>
          {describePullRequest(pr, statuses, unseen, now)}
          {refreshingMerge && `. Updating merge status`}
          {teamRequest && `. ${teamRequest}`}
          {hiddenBecause && `. Hidden from the list: ${hiddenBecause}`}
        </span>
      </div>
      {expanded && <PullRequestDetails pr={pr} id={detailId} />}
    </li>
  );
}
