import { signal } from '@preact/signals';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Section, SectionKind, Snapshot } from '../../lib/model';
import { isMuted, isSeen, isSnoozed } from '../../lib/storage/prLocal';
import {
  AlertIcon,
  ClockIcon,
  EyeIcon,
  FilterIcon,
  GitPullRequestIcon,
  InboxIcon,
  MentionIcon,
  PersonIcon,
  SearchIcon,
} from '../components/icons';
import type { IconComponent } from '../components/icons/Icon';
import { PullRequestCard } from '../components/PullRequestCard';
import { panelId, SectionTabs } from '../components/SectionTabs';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { TextField } from '../components/ui/TextField';
import { useNow } from '../components/useNow';
import { sendToBackground } from '../state/background';
import { navigate } from '../state/router';
import { auth, pollState, prLocal, settings, snapshot } from '../state/store';
import { filterPullRequests, sortPullRequests } from './ListModel';
import './List.css';

/** How long a card must stay on screen before it counts as seen. */
const SEEN_DELAY_MS = 1500;

/**
 * Selected tab and quick filter live outside the view, so they survive a visit to Settings.
 * Exported for tests, which reset them.
 */
export const activeSectionId = signal<string | undefined>(undefined);
export const filterQuery = signal('');

/**
 * Per section kind: its icon and short name in the section bar (a custom section shows its own
 * label) and the hint of its empty list. A new kind is one entry here.
 */
const KINDS: Record<SectionKind, { icon: IconComponent; short?: string; empty: string }> = {
  authored: {
    icon: GitPullRequestIcon,
    short: 'Mine',
    empty: 'Pull requests you open will show up here.',
  },
  review_requested: {
    icon: EyeIcon,
    short: 'Review',
    empty: 'When someone asks for your review, it will show up here.',
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

const pullRequestsOf = (snap: Snapshot, sectionId: string) =>
  (snap.sections[sectionId] ?? []).flatMap((id) => snap.pullRequests[id] ?? []);

/**
 * Sends `markSeen` for the unseen cards that have been on screen for `SEEN_DELAY_MS` while the
 * panel is visible. A scroll or a new snapshot restarts the wait, so only cards the user rested
 * on are marked; a card behind the section bar is not on screen. `renderedKey` changes with the
 * rendered cards and the bar; `unseenIds` are the ones to mark.
 */
function useMarkSeen(
  list: { current: HTMLElement | null },
  renderedKey: string,
  unseenIds: string[],
) {
  const [onScreen, setOnScreen] = useState<string[]>([]);
  const [panelVisible, setPanelVisible] = useState(() => document.visibilityState === 'visible');
  const unseenKey = unseenIds.join('\n');

  useEffect(() => {
    const update = () => setPanelVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const visible = new Set<string>();
    const bar = document.querySelector<HTMLElement>('[data-bottom-bar]')?.offsetHeight ?? 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const id = (target as HTMLElement).dataset.prId;
          if (id) visible[isIntersecting ? 'add' : 'delete'](id);
        }
        setOnScreen([...visible]);
      },
      { threshold: 0.6, rootMargin: `0px 0px ${-bar}px 0px` },
    );
    for (const card of list.current?.querySelectorAll('[data-pr-id]') ?? []) observer.observe(card);
    return () => {
      observer.disconnect();
      setOnScreen([]);
    };
  }, [renderedKey]);

  useEffect(() => {
    const unseen = new Set(unseenKey.split('\n'));
    const prIds = onScreen.filter((id) => unseen.has(id));
    if (!panelVisible || prIds.length === 0) return;
    const timer = setTimeout(
      () => void sendToBackground({ type: 'markSeen', prIds }),
      SEEN_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [panelVisible, onScreen, unseenKey]);
}

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

function SectionNotice({ section, message }: { section: Section; message: string }) {
  return (
    <p class="list__notice">
      <AlertIcon size={16} />
      <span>
        Could not load “{section.label}”: {message}
      </span>
    </p>
  );
}

/** Marked once, when cards first render: the E2E perf budget measures time to this mark. */
export const LIST_RENDERED_MARK = 'prowl:list-rendered';
let listRendered = false;

/** The pull request list: a quick filter, one card per PR and the section bar at the bottom. */
export function ListView() {
  const now = useNow(30_000);
  const idPrefix = useId();
  const list = useRef<HTMLUListElement>(null);
  const filterInput = useRef<HTMLElement>(null);

  const { sections, sort } = settings.value;
  // A snapshot left by another account (sign-out raced a poll) is never shown.
  const viewer = auth.value?.viewer.login.toLowerCase();
  const raw = snapshot.value;
  const snap = raw && (!viewer || raw.viewer.login.toLowerCase() === viewer) ? raw : undefined;
  const local = prLocal.value;
  const query = filterQuery.value;
  const enabled = sections.filter((section) => section.enabled);
  const selected = enabled.find((section) => section.id === activeSectionId.value) ?? enabled[0];

  // Per section, the PRs that pass the filter in the chosen order; snoozed ones are set aside.
  const clock = Date.now();
  const snoozed = (id: string) => isSnoozed(local, id, clock);
  const filtered = new Map(
    enabled.map((section) => [
      section.id,
      snap
        ? sortPullRequests(filterPullRequests(pullRequestsOf(snap, section.id), query), sort)
        : [],
    ]),
  );
  const matching = new Map(
    [...filtered].map(([id, prs]) => [id, prs.filter((pr) => !snoozed(pr.id))]),
  );
  const shown = (selected && matching.get(selected.id)) || [];
  const shownSnoozed = ((selected && filtered.get(selected.id)) || []).filter((pr) =>
    snoozed(pr.id),
  );
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  useEffect(() => {
    if (listRendered || shown.length === 0) return;
    listRendered = true;
    performance.mark(LIST_RENDERED_MARK);
  });
  useMarkSeen(
    list,
    [enabled.length > 1, ...shown.map((pr) => pr.id)].join('\n'),
    shown.filter((pr) => !isSeen(local, pr.id, pr.updatedAt)).map((pr) => pr.id),
  );

  if (!selected) {
    return (
      <EmptyState
        icon={<InboxIcon size={24} />}
        title="No sections turned on"
        description="Choose which pull requests Prowl follows in Settings."
        action={<Button onClick={() => navigate('settings')}>Open settings</Button>}
      />
    );
  }

  if (!snap) {
    const failure = pollState.value;
    // The banner above has the reason and the way out (retry, re-authenticate).
    return failure?.lastError && !failure.inFlight ? (
      <EmptyState
        icon={<AlertIcon size={24} />}
        title="Could not load pull requests"
        description="Nothing has been fetched yet. The notice above says why."
      />
    ) : (
      <ListSkeleton />
    );
  }

  const error = snap.sectionErrors?.[selected.id];
  // Empty only because of the filter: the section itself has pull requests.
  const filteredOut =
    shown.length === 0 && shownSnoozed.length === 0 && pullRequestsOf(snap, selected.id).length > 0;
  const anyPullRequests = enabled.some((section) => pullRequestsOf(snap, section.id).length > 0);
  const tabs = enabled.map((section) => {
    const { icon: Icon, short } = KINDS[section.kind];
    return {
      id: section.id,
      label: short ?? section.label,
      fullLabel: section.label,
      icon: <Icon />,
      count: matching.get(section.id)?.length ?? 0,
      failed: snap.sectionErrors?.[section.id] !== undefined,
    };
  });

  // A lone section has no tabs. The panel is named by the section's full name rather than by its
  // tab, which is not there when the section is under "More".
  const panelProps =
    tabs.length > 1 ? { role: 'tabpanel' as const, 'aria-label': selected.label } : {};

  return (
    <div class="list">
      {anyPullRequests && (
        <div class="list__filter">
          <TextField
            label="Filter pull requests"
            hideLabel
            type="search"
            icon={<SearchIcon />}
            placeholder="Filter by title, repo, author or label"
            value={query}
            onValueChange={(value) => {
              filterQuery.value = value;
            }}
            autoComplete="off"
            spellcheck={false}
            inputRef={filterInput}
          />
        </div>
      )}
      {/* Fixed at the bottom of the panel, but before the list in the DOM: the tabs come before the
          panel they control, and the keyboard reaches them without going through every card. */}
      {tabs.length > 1 && (
        <SectionTabs
          tabs={tabs}
          selectedId={selected.id}
          onSelect={(id) => {
            activeSectionId.value = id;
          }}
          idPrefix={idPrefix}
        />
      )}
      <div id={panelId(idPrefix)} {...panelProps}>
        {error !== undefined && <SectionNotice section={selected} message={error} />}
        {shown.length > 0 && (
          <ul class="pr-list" ref={list} aria-label={`${selected.label} pull requests`}>
            {shown.map((pr) => (
              <PullRequestCard
                key={pr.id}
                pr={pr}
                now={now}
                unseen={!isSeen(local, pr.id, pr.updatedAt)}
                muted={isMuted(local, pr.id)}
              />
            ))}
          </ul>
        )}
        {shownSnoozed.length > 0 && (
          <div class="list__snoozed">
            <Button
              size="sm"
              variant="ghost"
              icon={<ClockIcon size={12} />}
              aria-expanded={snoozedOpen}
              onClick={() => setSnoozedOpen(!snoozedOpen)}
            >
              Snoozed ({shownSnoozed.length})
            </Button>
            {snoozedOpen && (
              <ul class="pr-list" aria-label={`Snoozed ${selected.label} pull requests`}>
                {shownSnoozed.map((pr) => (
                  <PullRequestCard
                    key={pr.id}
                    pr={pr}
                    now={now}
                    unseen={false}
                    muted={isMuted(local, pr.id)}
                    snoozedUntil={local.snoozed[pr.id]}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
        {shown.length === 0 && shownSnoozed.length === 0 && error === undefined && (
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
        )}
      </div>
    </div>
  );
}
