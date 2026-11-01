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
effect(() => {
  const login = auth.value?.viewer.login.toLowerCase();
  if (account !== login) {
    account = login;
    batch(() => {
      activeSectionId.value = undefined;
      foldedGroups.value = [];
      filterQuery.value = '';
      showHidden.value = false;
    });
  }
  const saved = panelState.value;
  if (!hydrated.value || !login) return;
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
const toggle = (folded: string[], key: string) =>
  folded.includes(key) ? folded.filter((value) => value !== key) : [...folded, key];

export async function toggleFolded(key: string): Promise<void> {
  foldedGroups.value = toggle(foldedGroups.value, key);
  await updateContext((current) => ({
    ...current,
    foldedGroups: toggle(current.foldedGroups, key),
  }));
}
