import type { RefObject } from 'preact';
import { useState } from 'preact/hooks';
import { describeHiddenReasons } from '../../lib/hidden';
import { t } from '../../lib/i18n';
import type { PullRequest, SectionKind } from '../../lib/model';
import { sectionLabel } from '../../lib/sectionLabel';
import { isMuted, isSeen } from '../../lib/storage/prLocal';
import {
  AlertIcon,
  ClockIcon,
  EyeClosedIcon,
  EyeIcon,
  FilterIcon,
  GitPullRequestIcon,
  InboxIcon,
  MentionIcon,
  PeopleIcon,
  PersonIcon,
  SearchIcon,
} from '../components/icons';
import type { IconComponent } from '../components/icons/Icon';
import { PullRequestCard } from '../components/PullRequestCard';
import { RepoGroup } from '../components/RepoGroup';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import {
  filterQuery,
  foldKey,
  type LoadedListData,
  pullRequestsOf,
  showHidden,
  toggleFolded,
} from './ListState';

/**
 * Per section kind: its icon and short name in the section bar (a custom section shows its own
 * label) and the hint of its empty list. A new kind is one entry here.
 */
export const KINDS: Record<SectionKind, { icon: IconComponent; short?: string; empty: string }> = {
  authored: {
    icon: GitPullRequestIcon,
    short: t('mine'),
    empty: t('pullRequestsYouOpenWillShowUpHere'),
  },
  review_requested: {
    icon: EyeIcon,
    short: t('review'),
    empty: t('whenSomeoneAsksYouForAReviewItWill'),
  },
  team_review_requested: {
    icon: PeopleIcon,
    short: t('teams'),
    empty: t('whenSomeoneAsksOneOfYourTeamsForA'),
  },
  mentioned: {
    icon: MentionIcon,
    short: t('mentions'),
    empty: t('pullRequestsThatMentionYouWillShowUpHere'),
  },
  assigned: {
    icon: PersonIcon,
    short: t('assigned'),
    empty: t('pullRequestsAssignedToYouWillShowUpHere'),
  },
  custom: { icon: FilterIcon, empty: t('noOpenPullRequestsMatchThisSearch') },
};

function ListCard({
  pr,
  data,
  grouped = false,
  snoozed = false,
  hiddenBecause,
}: {
  pr: PullRequest;
  data: LoadedListData;
  grouped?: boolean;
  snoozed?: boolean;
  hiddenBecause?: string;
}) {
  return (
    <PullRequestCard
      pr={pr}
      now={data.now}
      unseen={!snoozed && !isSeen(data.local, pr.id, pr.updatedAt)}
      muted={isMuted(data.local, pr.id)}
      teams={data.snap.teamRequests?.[pr.id]}
      grouped={grouped}
      snoozedUntil={snoozed ? data.local.snoozed[pr.id] : undefined}
      hiddenBecause={hiddenBecause}
    />
  );
}

function ShownRequests({ data }: { data: LoadedListData }) {
  const { shown, selected, grouped, groups, isFolded } = data;
  const card = (pr: PullRequest) => <ListCard key={pr.id} pr={pr} data={data} grouped={grouped} />;
  return (
    shown.length > 0 && (
      <ul class="pr-list" aria-label={t('pullRequests2', sectionLabel(selected))}>
        {grouped
          ? groups.map(({ repo, prs }) => (
              <RepoGroup
                key={repo}
                repo={repo}
                count={prs.length}
                expanded={!isFolded(repo)}
                onToggle={() => toggleFolded(foldKey(selected.id, repo))}
              >
                {prs.map(card)}
              </RepoGroup>
            ))
          : shown.map(card)}
      </ul>
    )
  );
}

function SnoozedRequests({ data }: { data: LoadedListData }) {
  const [open, setOpen] = useState(false);
  const { snoozed, selected } = data;
  return (
    snoozed.length > 0 && (
      <div class="list__aside">
        <Button
          class="list__aside-toggle"
          size="sm"
          variant="ghost"
          icon={<ClockIcon size={12} />}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t('snoozedCount', snoozed.length)}
        </Button>
        {open && (
          <ul class="pr-list" aria-label={t('snoozedPullRequests', sectionLabel(selected))}>
            {snoozed.map((pr) => (
              <ListCard key={pr.id} pr={pr} data={data} snoozed />
            ))}
          </ul>
        )}
      </div>
    )
  );
}

function HiddenRequests({ data }: { data: LoadedListData }) {
  const { hidden, selected } = data;
  return (
    hidden.length > 0 && (
      <div class="list__aside">
        <Button
          class="list__aside-toggle"
          size="sm"
          variant="ghost"
          icon={showHidden.value ? <EyeClosedIcon size={12} /> : <EyeIcon size={12} />}
          aria-expanded={showHidden.value}
          onClick={() => {
            showHidden.value = !showHidden.value;
          }}
        >
          {showHidden.value ? t('hideAgain') : t('showHidden', hidden.length)}
        </Button>
        {showHidden.value && (
          <ul class="pr-list" aria-label={t('hiddenPullRequests', sectionLabel(selected))}>
            {hidden.map(({ pr, reasons }) => (
              <ListCard
                key={pr.id}
                pr={pr}
                data={data}
                hiddenBecause={describeHiddenReasons(reasons)}
              />
            ))}
          </ul>
        )}
      </div>
    )
  );
}

function EmptySection({
  data,
  filterInput,
}: {
  data: LoadedListData;
  filterInput: RefObject<HTMLElement>;
}) {
  const { shown, hidden, snoozed, snap, selected, query } = data;
  if (
    shown.length + hidden.length + snoozed.length > 0 ||
    snap.sectionErrors?.[selected.id] !== undefined
  )
    return null;
  // Empty only because of the filter: the section itself has pull requests.
  const filteredOut = pullRequestsOf(snap, selected.id).length > 0;
  return (
    <EmptyState
      icon={filteredOut ? <SearchIcon size={24} /> : <InboxIcon size={24} />}
      title={filteredOut ? t('noMatches') : t('noPullRequests')}
      description={
        filteredOut
          ? t('nothingInMatches', sectionLabel(selected), query.trim())
          : KINDS[selected.kind].empty
      }
      action={
        filteredOut ? (
          <Button
            onClick={() => {
              filterQuery.value = '';
              filterInput.current?.focus();
            }}
          >
            {t('clearFilter')}
          </Button>
        ) : undefined
      }
    />
  );
}

export function SectionContent({
  data,
  filterInput,
}: {
  data: LoadedListData;
  filterInput: RefObject<HTMLElement>;
}) {
  const error = data.snap.sectionErrors?.[data.selected.id];
  return (
    <>
      {error !== undefined && (
        <p class="list__notice">
          <AlertIcon size={16} />
          <span>{t('sectionLoadError', sectionLabel(data.selected), error)}</span>
        </p>
      )}
      <ShownRequests data={data} />
      <SnoozedRequests data={data} />
      <HiddenRequests data={data} />
      <EmptySection data={data} filterInput={filterInput} />
    </>
  );
}
