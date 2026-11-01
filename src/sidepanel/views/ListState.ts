import { signal } from '@preact/signals';
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

/** These choices survive Settings and last until the panel closes; tests reset them. */
export const activeSectionId = signal<string | undefined>(undefined);
export const filterQuery = signal('');
export const showHidden = signal(false);
export const foldedGroups = signal<string[]>([]);

export const foldKey = (sectionId: string, repo: string) => `${sectionId}\n${repo}`;
export function toggleFolded(key: string) {
  const folded = foldedGroups.value;
  foldedGroups.value = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key];
}

const NOTHING: SectionParts = { shown: [], hidden: [], snoozed: [] };
export const pullRequestsOf = (snap: Snapshot, sectionId: string) =>
  (snap.sections[sectionId] ?? []).flatMap((id) => snap.pullRequests[id] ?? []);

function currentSnapshot() {
  // Never show a snapshot left by another account when sign-out raced a poll.
  const viewer = auth.value?.viewer.login.toLowerCase();
  const raw = snapshot.value;
  return raw && (!viewer || raw.viewer.login.toLowerCase() === viewer) ? raw : undefined;
}

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
  const { shown, hidden, snoozed } = (selected && parts.get(selected.id)) || NOTHING;
  const grouped = current.groupByRepo;
  const groups = grouped ? groupByRepo(shown) : [];
  const isFolded = (repo: string) => foldedGroups.value.includes(foldKey(selected?.id ?? '', repo));
  const rendered = grouped
    ? groups.filter(({ repo }) => !isFolded(repo)).flatMap((g) => g.prs)
    : shown;
  const revealed = showHidden.value ? hidden.map(({ pr }) => pr) : [];
  return {
    now,
    snap,
    local,
    query,
    enabled,
    selected,
    parts,
    shown,
    hidden,
    snoozed,
    grouped,
    groups,
    isFolded,
    seeable: [...rendered, ...revealed],
  };
}

export type ListData = ReturnType<typeof useListData>;
export type LoadedListData = ListData & { snap: Snapshot; selected: Section };

/** Marked once when cards first render; the E2E performance budget measures this. */
export const LIST_RENDERED_MARK = 'prowl:list-rendered';
let listRendered = false;
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

/** Only cards rested on while the panel is visible count as seen; folds remove their cards. */
function useMarkSeen(
  list: { current: HTMLElement | null },
  renderedKey: string,
  unseenKey: string,
) {
  const [onScreen, setOnScreen] = useState<string[]>([]);
  const panelVisible = usePanelVisible();
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
      () => void sendToBackground({ type: 'markSeen', prIds }),
      SEEN_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [panelVisible, onScreen, unseenKey]);
}

export function useListVisibility(panel: { current: HTMLElement | null }, data: ListData) {
  useEffect(() => {
    if (listRendered || data.shown.length === 0) return;
    listRendered = true;
    performance.mark(LIST_RENDERED_MARK);
  });
  useMarkSeen(
    panel,
    [data.enabled.length > 1, ...data.seeable.map((pr) => pr.id)].join('\n'),
    data.seeable
      .filter((pr) => !isSeen(data.local, pr.id, pr.updatedAt))
      .map((pr) => pr.id)
      .join('\n'),
  );
}
