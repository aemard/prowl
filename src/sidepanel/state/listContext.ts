import { batch, effect, signal } from '@preact/signals';
import type { PanelState } from '../../lib/model';
import { normalizePanelState } from '../../lib/storage/panelState';
import { withSignedIn } from '../../lib/storage/session';
import { updateItem } from '../../lib/storage/storage';
import { auth, hydrated, panelState } from './store';

export const activeSectionId = signal<string | undefined>(undefined);
export const foldedGroups = signal<string[]>([]);
/** Filters and temporary reveals never survive closing the panel or changing account. */
export const filterQuery = signal('');
export const showHidden = signal(false);

let account: string | undefined;
let restored = false;
effect(() => {
  const login = auth.value?.viewer.login.toLowerCase();
  if (account !== login) {
    account = login;
    restored = false;
    batch(() => {
      activeSectionId.value = undefined;
      foldedGroups.value = [];
      filterQuery.value = '';
      showHidden.value = false;
    });
  }
  // Once per account: later storage events are this panel's own writes coming back, and
  // applying them would replay older choices over newer ones.
  if (restored || !hydrated.value || !login) return;
  restored = true;
  const saved = panelState.peek();
  const matching = saved?.login === login ? saved : undefined;
  batch(() => {
    activeSectionId.value = matching?.activeSectionId;
    foldedGroups.value = matching?.foldedGroups ?? [];
  });
});

async function updateContext(change: (current: PanelState) => PanelState): Promise<void> {
  const session = auth.value;
  if (!session) return;
  const login = session.viewer.login.toLowerCase();
  await withSignedIn(session, () =>
    updateItem('panelState', (raw) => {
      const saved = normalizePanelState(raw);
      return change(saved?.login === login ? saved : { login, foldedGroups: [] });
    }),
  );
}

export async function selectSection(id: string): Promise<void> {
  activeSectionId.value = id;
  await updateContext((current) => ({ ...current, activeSectionId: id }));
}

export const foldKey = (sectionId: string, repo: string) => `${sectionId}\n${repo}`;

/** Stores the new state of the key, not a flip: another panel window may have flipped it first. */
export async function toggleFolded(key: string): Promise<void> {
  const fold = !foldedGroups.value.includes(key);
  const apply = (folded: string[]) => {
    const rest = folded.filter((value) => value !== key);
    return fold ? [...rest, key] : rest;
  };
  foldedGroups.value = apply(foldedGroups.value);
  await updateContext((current) => ({ ...current, foldedGroups: apply(current.foldedGroups) }));
}
