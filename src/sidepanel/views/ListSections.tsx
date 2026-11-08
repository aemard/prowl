import type { RefObject } from 'preact';
import { useState } from 'preact/hooks';
import { activityKey } from '../../lib/activity';
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
import { SectionCoverageNotice } from '../components/SectionCoverageNotice';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { pollState } from '../state/store';
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
      unseen={!snoozed && !isSeen(data.local, pr.id, pr.updatedAt, activityKey(pr))}
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

function SnoozedRequests({
  data,
  open,
  setOpen,
}: {
  data: LoadedListData;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
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
    snap.sectionErrors?.[selected.id] !== undefined ||
    searching(data)
  )
    return null;
  // Empty only because of the filter: the section itself has pull requests.
  const filteredOut = pullRequestsOf(snap, selected.id).length > 0;
  return (
    <EmptyState
      icon={filteredOut ? <SearchIcon size={24} /> : <InboxIcon size={24} />}
      title={filteredOut ? 'No matches' : 'No pull requests'}
      description={
        filteredOut
          ? `Nothing in “${selected.label}” matches “${query.trim()}”.${snap.sectionCoverage?.[selected.id]?.hasMore ? ' This search only covers the loaded PRs.' : ''}`
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
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const loaded = pullRequestsOf(data.snap, data.selected.id).length;
  const matches = data.shown.length + data.hidden.length + data.snoozed.length;
  const setAside =
    data.shown.length === 0 &&
    matches > 0 &&
    !(showHidden.value && data.hidden.length > 0) &&
    !(snoozedOpen && data.snoozed.length > 0);
  const error = data.snap.sectionErrors?.[data.selected.id];
  const coverage = data.snap.sectionCoverage?.[data.selected.id];
  return (
    <>
      {loaded > 0 && (
        <p
          class="list__summary"
          role="note"
          title="Tab counts show main-list PRs after filtering, including folded groups. Temporary reveals do not affect the badge."
        >
          {loaded} loaded · {data.query.trim() && `${matches} matching · `}
          {data.shown.length} in list · {data.hidden.length} hidden · {data.snoozed.length} snoozed
          <span class="sr-only">
            . Tab counts include folded groups. The badge ignores this text filter, counts unique
            PRs across sections and excludes hidden and snoozed PRs.
          </span>
        </p>
      )}
      {searching(data) && (
        <p class="list__notice" role="status">
          Searching “{data.selected.label}”…
        </p>
      )}
      {error !== undefined && (
        <p class="list__notice">
          <AlertIcon size={16} />
          <span>
            {coverage?.partial ? 'Partial results for' : 'Could not load'} “{data.selected.label}”:{' '}
            {error}
          </span>
        </p>
      )}
      {coverage && (
        <SectionCoverageNotice
          coverage={coverage}
          count={pullRequestsOf(data.snap, data.selected.id).length}
        />
      )}
      {setAside && !searching(data) && (
        <EmptyState
          icon={<EyeClosedIcon size={24} />}
          title={
            data.query.trim()
              ? 'Matches are hidden or snoozed'
              : 'All loaded pull requests are set aside'
          }
          description="Automatic hiding and snooze keep these PRs out of the main list. You can reveal them below or choose Always show in a PR’s menu."
          action={
            <Button
              onClick={() => {
                showHidden.value = true;
                setSnoozedOpen(true);
                // This notice goes away with the click: the toggle below stays and now reads
                // "Hide again", so keyboard focus does not fall back to the page.
                filterInput.current
                  ?.closest('.list')
                  ?.querySelector<HTMLElement>('.list__aside-toggle')
                  ?.focus();
              }}
            >
              Show hidden and snoozed
            </Button>
          }
        />
      )}
      <ShownRequests data={data} />
      <SnoozedRequests data={data} open={snoozedOpen} setOpen={setSnoozedOpen} />
      <HiddenRequests data={data} />
      <EmptySection data={data} filterInput={filterInput} />
    </>
  );
}

function searching(data: LoadedListData) {
  return (
    pollState.value?.inFlight === true &&
    (data.snap.sectionsPending?.includes(data.selected.id) ||
      (!(data.selected.id in data.snap.sections) && !data.snap.sectionErrors?.[data.selected.id]))
  );
}
