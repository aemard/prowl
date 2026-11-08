import { useEffect, useState } from 'preact/hooks';
import type { Section, Snapshot } from '../../lib/model';
import { isSeen } from '../../lib/storage/prLocal';
import { useNow } from '../components/useNow';
import { sendToBackground } from '../state/background';
import { auth, prLocal, settings, snapshot } from '../state/store';
import {
  filterPullRequests,
  groupByRepo,
  type SectionParts,
  sortPullRequests,
  splitSection,
} from './ListModel';

export {
  activeSectionId,
  filterQuery,
  foldedGroups,
  foldKey,
  toggleFolded,
} from '../state/listContext';

import { activityKey } from '../../lib/activity';
import { activeSectionId, filterQuery, foldedGroups, foldKey } from '../state/listContext';

const NOTHING: SectionParts = { shown: [], snoozed: [] };
export const pullRequestsOf = (snap: Snapshot, sectionId: string) =>
  (snap.sections[sectionId] ?? []).flatMap((id) => snap.pullRequests[id] ?? []);

function currentSnapshot() {
  // Never show a snapshot left by another account when sign-out raced a poll.
  const viewer = auth.value?.viewer.login.toLowerCase();
  const raw = snapshot.value;
  return raw && (!viewer || raw.viewer.login.toLowerCase() === viewer) ? raw : undefined;
}

/**
 * Per section, the PRs that pass the filter in the chosen order: cards (counted)
 * and snoozed ones set aside behind one fold at the end.
 */
function sectionParts(enabled: Section[], snap: Snapshot | undefined, query: string) {
  const current = settings.value;
  const local = prLocal.value;
  const clock = Date.now();
  return new Map(
    enabled.map((section) => [
      section.id,
      snap
        ? splitSection(
            sortPullRequests(
              filterPullRequests(pullRequestsOf(snap, section.id), query),
              current.sort,
            ),
            local,
            current,
            clock,
          )
        : NOTHING,
    ]),
  );
}

export function useListData() {
  const now = useNow(30_000);
  const current = settings.value;
  const snap = currentSnapshot();
  const local = prLocal.value;
  const query = filterQuery.value;
  const enabled = current.sections.filter((section) => section.enabled);
  const selected = enabled.find((section) => section.id === activeSectionId.value) ?? enabled[0];
  const parts = sectionParts(enabled, snap, query);
  const { shown, snoozed } = (selected && parts.get(selected.id)) || NOTHING;
  // Grouped, only the cards of open groups are rendered: a folded group is not on screen, so its
  // cards are not marked seen. Snoozed PRs stay flat, with their repository on the card.
  const grouped = current.groupByRepo;
  const groups = grouped ? groupByRepo(shown) : [];
  const isFolded = (repo: string) => foldedGroups.value.includes(foldKey(selected?.id ?? '', repo));
  const rendered = grouped
    ? groups.filter(({ repo }) => !isFolded(repo)).flatMap((g) => g.prs)
    : shown;
  return {
    now,
    snap,
    local,
    query,
    enabled,
    selected,
    parts,
    shown,
    snoozed,
    grouped,
    groups,
    isFolded,
    seeable: rendered,
  };
}

export type ListData = ReturnType<typeof useListData>;
export type LoadedListData = ListData & { snap: Snapshot; selected: Section };

/** Marked once when cards first render; the E2E performance budget measures this. */
export const LIST_RENDERED_MARK = 'prowl:list-rendered';
let listRendered = false;
/** How long a card must stay on screen before it counts as seen. */
const SEEN_DELAY_MS = 1500;

function usePanelVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function bottomBarHeight() {
  const bar = document.querySelector<HTMLElement>('[data-bottom-bar]');
  return bar ? bar.offsetHeight + (Number.parseFloat(getComputedStyle(bar).bottom) || 0) : 0;
}

/**
 * Sends `markSeen` for the unseen cards that have been on screen for `SEEN_DELAY_MS` while the
 * panel is visible. A scroll or a new snapshot restarts the wait, so only cards the user rested
 * on are marked; a card behind the section bar is not on screen. `renderedKey` changes with the
 * rendered cards and the bar; `unseenKey` lists the ones to mark, one id per line.
 */
function useMarkSeen(
  list: { current: HTMLElement | null },
  renderedKey: string,
  unseenKey: string,
  versions: Record<string, string>,
) {
  const [onScreen, setOnScreen] = useState<string[]>([]);
  const panelVisible = usePanelVisible();
  const versionKey = JSON.stringify(versions);
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const id = (target as HTMLElement).dataset.prId;
          if (id) visible[isIntersecting ? 'add' : 'delete'](id);
        }
        setOnScreen([...visible]);
      },
      { threshold: 0.6, rootMargin: `0px 0px ${-bottomBarHeight()}px 0px` },
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
      () =>
        void sendToBackground({
          type: 'markSeen',
          prIds,
          versions: Object.fromEntries(
            Object.entries(versions).filter(([id]) => prIds.includes(id)),
          ),
        }),
      SEEN_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [panelVisible, onScreen, unseenKey, versionKey]);
}

export function useListVisibility(panel: { current: HTMLElement | null }, data: ListData) {
  useEffect(() => {
    if (listRendered || data.shown.length === 0) return;
    listRendered = true;
    performance.mark(LIST_RENDERED_MARK);
  });
  const versions = Object.fromEntries(data.seeable.map((pr) => [pr.id, activityKey(pr)]));
  useMarkSeen(
    panel,
    [data.enabled.length > 1, ...data.seeable.map((pr) => `${pr.id}:${versions[pr.id]}`)].join(
      '\n',
    ),
    data.seeable
      .filter((pr) => !isSeen(data.local, pr.id, pr.updatedAt, activityKey(pr)))
      .map((pr) => pr.id)
      .join('\n'),
    versions,
  );
}
