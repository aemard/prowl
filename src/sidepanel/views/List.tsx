import type { RefObject } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { AlertIcon, InboxIcon, SearchIcon } from '../components/icons';
import { panelId, SectionTabs } from '../components/SectionTabs';
import { StatusBanner } from '../components/StatusBanner';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { TextField } from '../components/ui/TextField';
import { navigate } from '../state/router';
import { pollState } from '../state/store';
import { KINDS, SectionContent } from './ListSections';
import {
  activeSectionId,
  filterQuery,
  type LoadedListData,
  pullRequestsOf,
  useListData,
  useListVisibility,
} from './ListState';
import './List.css';

export {
  activeSectionId,
  filterQuery,
  foldedGroups,
  LIST_RENDERED_MARK,
  showHidden,
} from './ListState';

function ListSkeleton() {
  return (
    <div class="list__skeleton" aria-busy="true" aria-label="Loading pull requests" role="status">
      {[0, 1, 2, 3].map((row) => (
        <div class="list__skeleton-row" key={row}>
          <div class="list__skeleton-head">
            <Skeleton shape="circle" width={16} />
            <Skeleton width="45%" />
          </div>
          <Skeleton width={row % 2 ? '70%' : '92%'} />
          <div class="list__skeleton-chips">
            <Skeleton shape="rect" width={72} height={20} />
            <Skeleton shape="rect" width={96} height={20} />
          </div>
        </div>
      ))}
    </div>
  );
}

function NoSections() {
  return (
    <>
      <StatusBanner />
      <EmptyState
        icon={<InboxIcon size={24} />}
        title="No sections turned on"
        description="Choose which pull requests Prowl follows in Settings."
        action={<Button onClick={() => navigate('settings')}>Open settings</Button>}
      />
    </>
  );
}

function LoadingList() {
  const failure = pollState.value;
  // The banner has the reason and the way out (retry, re-authenticate).
  return (
    <>
      <StatusBanner />
      {failure?.lastError && !failure.inFlight ? (
        <EmptyState
          icon={<AlertIcon size={24} />}
          title="Could not load pull requests"
          description="Nothing has been fetched yet. The notice above says why."
        />
      ) : (
        <ListSkeleton />
      )}
    </>
  );
}

function QuickFilter({ input }: { input: RefObject<HTMLElement> }) {
  return (
    <div class="list__filter">
      <TextField
        label="Filter pull requests"
        hideLabel
        type="search"
        icon={<SearchIcon />}
        placeholder="Filter by title, repo, author or label"
        value={filterQuery.value}
        onValueChange={(value) => {
          filterQuery.value = value;
        }}
        autoComplete="off"
        spellcheck={false}
        inputRef={input}
      />
    </div>
  );
}

function sectionTabs(data: LoadedListData) {
  return data.enabled.map((section) => {
    const { icon: Icon, short } = KINDS[section.kind];
    return {
      id: section.id,
      label: short ?? section.label,
      fullLabel: section.label,
      icon: <Icon />,
      count: data.parts.get(section.id)?.shown.length ?? 0,
      failed: data.snap.sectionErrors?.[section.id] !== undefined,
    };
  });
}

function LoadedList({
  data,
  panel,
  filterInput,
  idPrefix,
}: {
  data: LoadedListData;
  panel: RefObject<HTMLDivElement>;
  filterInput: RefObject<HTMLElement>;
  idPrefix: string;
}) {
  const tabs = sectionTabs(data);
  const anyPullRequests = data.enabled.some(
    (section) => pullRequestsOf(data.snap, section.id).length > 0,
  );
  // A section under More has no tab to name its panel; use its full label instead.
  const panelProps =
    tabs.length > 1 ? { role: 'tabpanel' as const, 'aria-label': data.selected.label } : {};
  return (
    <div class="list">
      {anyPullRequests && <QuickFilter input={filterInput} />}
      <StatusBanner />
      {/* The fixed bar precedes its panel in the DOM, so keyboard users reach tabs before cards. */}
      {tabs.length > 1 && (
        <SectionTabs
          tabs={tabs}
          selectedId={data.selected.id}
          onSelect={(id) => {
            activeSectionId.value = id;
          }}
          idPrefix={idPrefix}
        />
      )}
      <div id={panelId(idPrefix)} ref={panel} {...panelProps}>
        <SectionContent data={data} filterInput={filterInput} />
      </div>
    </div>
  );
}

/** Quick filter, cards and the section bar, with account-safe state and visibility tracking. */
export function ListView() {
  const data = useListData();
  const idPrefix = useId();
  const panel = useRef<HTMLDivElement>(null);
  const filterInput = useRef<HTMLElement>(null);
  useListVisibility(panel, data);
  if (!data.selected) return <NoSections />;
  if (!data.snap) return <LoadingList />;
  return (
    <LoadedList
      data={{ ...data, snap: data.snap, selected: data.selected }}
      panel={panel}
      filterInput={filterInput}
      idPrefix={idPrefix}
    />
  );
}
