import { signal } from '@preact/signals';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { describeHiddenReasons } from '../../lib/hidden';
import { t } from '../../lib/i18n';
import type { PullRequest, Section, SectionKind, Snapshot } from '../../lib/model';
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
import { panelId, SectionTabs } from '../components/SectionTabs';
import { StatusBanner } from '../components/StatusBanner';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { TextField } from '../components/ui/TextField';
import { useNow } from '../components/useNow';
import { sendToBackground } from '../state/background';
import { navigate } from '../state/router';
import { auth, pollState, prLocal, settings, snapshot } from '../state/store';
import {
  filterPullRequests,
  groupByRepo,
  type SectionParts,
  sortPullRequests,
  splitSection,
} from './ListModel';
import './List.css';

/** How long a card must stay on screen before it counts as seen. */
const SEEN_DELAY_MS = 1500;

/**
 * Selected tab, quick filter, whether hidden PRs are revealed and which repository groups are
 * folded (a `foldKey` per section and repository) live outside the view, so they survive a
 * visit to Settings and last until the panel closes. Exported for tests, which reset them.
 */
export const activeSectionId = signal<string | undefined>(undefined);
export const filterQuery = signal('');
export const showHidden = signal(false);
export const foldedGroups = signal<string[]>([]);

const foldKey = (sectionId: string, repo: string) => `${sectionId}\n${repo}`;
const toggleFolded = (key: string) => {
  const folded = foldedGroups.value;
  foldedGroups.value = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key];
};

const NOTHING: SectionParts = { shown: [], hidden: [], snoozed: [] };

/**
 * Per section kind: its icon and short name in the section bar (a custom section shows its own
 * label) and the hint of its empty list. A new kind is one entry here.
 */
const KINDS: Record<SectionKind, { icon: IconComponent; short?: string; empty: string }> = {
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
    const barElement = document.querySelector<HTMLElement>('[data-bottom-bar]');
    const bar = barElement
      ? barElement.offsetHeight + (Number.parseFloat(getComputedStyle(barElement).bottom) || 0)
      : 0;
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

  // Scrolling and folding only adjust the next poll's order; they never fetch on their own.
  const onScreenKey = onScreen.join('\n');
  const fetchedAt = snapshot.value?.fetchedAt;
  useEffect(() => {
    void sendToBackground({ type: 'mergePriority', prIds: panelVisible ? onScreen : [] });
    return () => {
      void sendToBackground({ type: 'mergePriority', prIds: [] });
    };
  }, [panelVisible, onScreenKey, fetchedAt]);

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

function SectionNotice({ section, message }: { section: Section; message: string }) {
  return (
    <p class="list__notice">
      <AlertIcon size={16} />
      <span>{t('sectionLoadError', sectionLabel(section), message)}</span>
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
  const panel = useRef<HTMLDivElement>(null);
  const filterInput = useRef<HTMLElement>(null);

  const current = settings.value;
  const { sections, sort } = current;
  // A snapshot left by another account (sign-out raced a poll) is never shown.
  const viewer = auth.value?.viewer.login.toLowerCase();
  const raw = snapshot.value;
  const snap = raw && (!viewer || raw.viewer.login.toLowerCase() === viewer) ? raw : undefined;
  const local = prLocal.value;
  const query = filterQuery.value;
  const enabled = sections.filter((section) => section.enabled);
  const selected = enabled.find((section) => section.id === activeSectionId.value) ?? enabled[0];

  // Per section, the PRs that pass the filter in the chosen order: cards (counted), hidden ones
  // and snoozed ones, each set aside behind a button at the end.
  const clock = Date.now();
  const parts = new Map(
    enabled.map((section) => [
      section.id,
      snap
        ? splitSection(
            sortPullRequests(filterPullRequests(pullRequestsOf(snap, section.id), query), sort),
            local,
            current,
            clock,
          )
        : NOTHING,
    ]),
  );
  const { shown, hidden, snoozed } = (selected && parts.get(selected.id)) || NOTHING;
  const revealed = showHidden.value ? hidden.map(({ pr }) => pr) : [];
  // Grouped, only the cards of open groups are rendered: a folded group is not on screen, so its
  // cards are not marked seen. Hidden and snoozed PRs stay flat, with their repository on the card.
  const grouped = current.groupByRepo;
  const groups = grouped ? groupByRepo(shown) : [];
  const isFolded = (repo: string) => foldedGroups.value.includes(foldKey(selected?.id ?? '', repo));
  const rendered = grouped
    ? groups.filter(({ repo }) => !isFolded(repo)).flatMap((g) => g.prs)
    : shown;
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  useEffect(() => {
    if (listRendered || shown.length === 0) return;
    listRendered = true;
    performance.mark(LIST_RENDERED_MARK);
  });
  const seeable = [...rendered, ...revealed];
  useMarkSeen(
    panel,
    [enabled.length > 1, ...seeable.map((pr) => pr.id)].join('\n'),
    seeable.filter((pr) => !isSeen(local, pr.id, pr.updatedAt)).map((pr) => pr.id),
  );

  if (!selected) {
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

  if (!snap) {
    const failure = pollState.value;
    // The banner above has the reason and the way out (retry, re-authenticate).
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

  const card = (pr: PullRequest) => (
    <PullRequestCard
      key={pr.id}
      pr={pr}
      now={now}
      unseen={!isSeen(local, pr.id, pr.updatedAt)}
      muted={isMuted(local, pr.id)}
      teams={snap.teamRequests?.[pr.id]}
      grouped={grouped}
    />
  );
  const error = snap.sectionErrors?.[selected.id];
  const empty = shown.length + hidden.length + snoozed.length === 0;
  // Empty only because of the filter: the section itself has pull requests.
  const filteredOut = empty && pullRequestsOf(snap, selected.id).length > 0;
  const anyPullRequests = enabled.some((section) => pullRequestsOf(snap, section.id).length > 0);
  const tabs = enabled.map((section) => {
    const { icon: Icon, short } = KINDS[section.kind];
    return {
      id: section.id,
      label: short ?? sectionLabel(section),
      fullLabel: sectionLabel(section),
      icon: <Icon />,
      count: parts.get(section.id)?.shown.length ?? 0,
      failed: snap.sectionErrors?.[section.id] !== undefined,
    };
  });

  // A lone section has no tabs. The panel is named by the section's full name rather than by its
  // tab, which is not there when the section is under "More".
  const panelProps =
    tabs.length > 1 ? { role: 'tabpanel' as const, 'aria-label': sectionLabel(selected) } : {};

  return (
    <div class="list">
      {anyPullRequests && (
        <div class="list__filter">
          <TextField
            label={t('filterPullRequests')}
            hideLabel
            type="search"
            icon={<SearchIcon />}
            placeholder={t('filterByTitleRepoAuthorOrLabel')}
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
      <StatusBanner />
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
      <div id={panelId(idPrefix)} ref={panel} {...panelProps}>
        {error !== undefined && <SectionNotice section={selected} message={error} />}
        {shown.length > 0 && (
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
        )}
        {snoozed.length > 0 && (
          <div class="list__aside">
            <Button
              class="list__aside-toggle"
              size="sm"
              variant="ghost"
              icon={<ClockIcon size={12} />}
              aria-expanded={snoozedOpen}
              onClick={() => setSnoozedOpen(!snoozedOpen)}
            >
              {t('snoozedCount', snoozed.length)}
            </Button>
            {snoozedOpen && (
              <ul class="pr-list" aria-label={t('snoozedPullRequests', sectionLabel(selected))}>
                {snoozed.map((pr) => (
                  <PullRequestCard
                    key={pr.id}
                    pr={pr}
                    now={now}
                    unseen={false}
                    muted={isMuted(local, pr.id)}
                    teams={snap.teamRequests?.[pr.id]}
                    snoozedUntil={local.snoozed[pr.id]}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
        {hidden.length > 0 && (
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
                  <PullRequestCard
                    key={pr.id}
                    pr={pr}
                    now={now}
                    unseen={!isSeen(local, pr.id, pr.updatedAt)}
                    muted={isMuted(local, pr.id)}
                    teams={snap.teamRequests?.[pr.id]}
                    hiddenBecause={describeHiddenReasons(reasons)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
        {empty && error === undefined && (
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
        )}
      </div>
    </div>
  );
}
