import type { RefObject } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { sectionLabel } from '../../lib/sectionLabel';
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
    <div
      class="list__skeleton"
      aria-busy="true"
      aria-label={t('loadingPullRequests')}
      role="status"
    >
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
        title={t('noSectionsTurnedOn')}
        description={t('chooseWhichPullRequestsProwlFollowsInSettings')}
        action={<Button onClick={() => navigate('settings')}>{t('openSettings')}</Button>}
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
          title={t('couldNotLoadPullRequests')}
          description={t('nothingHasBeenFetchedYetTheNoticeAboveSays')}
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
        label={t('filterPullRequests')}
        hideLabel
        type="search"
        icon={<SearchIcon />}
        placeholder={t('filterByTitleRepoAuthorOrLabel')}
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
      label: short ?? sectionLabel(section),
      fullLabel: sectionLabel(section),
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
  // A lone section has no tabs. The panel is named by the section's full name rather than by its
  // tab, which is not there when the section is under "More".
  const panelProps =
    tabs.length > 1 ? { role: 'tabpanel' as const, 'aria-label': sectionLabel(data.selected) } : {};
  return (
    <div class="list">
      {anyPullRequests && <QuickFilter input={filterInput} />}
      <StatusBanner />
      {/* Fixed at the bottom of the panel, but before the list in the DOM: the tabs come before the
          panel they control, and the keyboard reaches them without going through every card. */}
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

/** The pull request list: a quick filter, one card per PR and the section bar at the bottom. */
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
