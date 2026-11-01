import type { RefObject } from 'preact';
import { useState } from 'preact/hooks';
import { describeHiddenReasons } from '../../lib/hidden';
import type { PullRequest, SectionKind } from '../../lib/model';
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

/** A new section kind needs its bar icon, short name and empty-list hint here. */
export const KINDS: Record<SectionKind, { icon: IconComponent; short?: string; empty: string }> = {
  authored: {
    icon: GitPullRequestIcon,
    short: 'Mine',
    empty: 'Pull requests you open will show up here.',
  },
  review_requested: {
    icon: EyeIcon,
    short: 'Review',
    empty: 'When someone asks you for a review, it will show up here.',
  },
  team_review_requested: {
    icon: PeopleIcon,
    short: 'Teams',
    empty: 'When someone asks one of your teams for a review, it will show up here.',
  },
  mentioned: {
    icon: MentionIcon,
    short: 'Mentions',
    empty: 'Pull requests that mention you will show up here.',
  },
  assigned: {
    icon: PersonIcon,
    short: 'Assigned',
    empty: 'Pull requests assigned to you will show up here.',
  },
  custom: { icon: FilterIcon, empty: 'No open pull requests match this search.' },
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
      <ul class="pr-list" aria-label={`${selected.label} pull requests`}>
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
          Snoozed ({snoozed.length})
        </Button>
        {open && (
          <ul class="pr-list" aria-label={`Snoozed ${selected.label} pull requests`}>
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
          {showHidden.value ? 'Hide again' : `Show ${hidden.length} hidden`}
        </Button>
        {showHidden.value && (
          <ul class="pr-list" aria-label={`Hidden ${selected.label} pull requests`}>
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
  const filteredOut = pullRequestsOf(snap, selected.id).length > 0;
  return (
    <EmptyState
      icon={filteredOut ? <SearchIcon size={24} /> : <InboxIcon size={24} />}
      title={filteredOut ? 'No matches' : 'No pull requests'}
      description={
        filteredOut
          ? `Nothing in “${selected.label}” matches “${query.trim()}”.`
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
            Clear filter
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
          <span>
            Could not load “{data.selected.label}”: {error}
          </span>
        </p>
      )}
      <ShownRequests data={data} />
      <SnoozedRequests data={data} />
      <HiddenRequests data={data} />
      <EmptySection data={data} filterInput={filterInput} />
    </>
  );
}
