import { afterEach, expect, it } from 'vitest';
import { normalizePanelState } from '../../lib/storage/panelState';
import { getItem, setItems } from '../../lib/storage/storage';
import { buildAuth } from '../../test/panel';
import {
  activeSectionId,
  filterQuery,
  foldedGroups,
  foldKey,
  selectSection,
  showHidden,
  toggleFolded,
} from './listContext';
import { signOut } from './session';
import { auth, hydrated, hydrateStore, panelState } from './store';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  hydrated.value = false;
  auth.value = undefined;
  panelState.value = undefined;
});

it('restores and updates account-local organization only after storage hydration', async () => {
  const key = foldKey('review_requested', 'acme/web');
  const saved = { login: 'octocat', activeSectionId: 'review_requested', foldedGroups: [key] };
  await setItems({ auth: buildAuth(), panelState: saved });
  stop = await hydrateStore();
  expect(activeSectionId.value).toBe('review_requested');
  expect(foldedGroups.value).toEqual([key]);
  filterQuery.value = 'temporary';
  showHidden.value = true;
  await selectSection('authored');
  await toggleFolded(key);
  expect(await getItem('panelState')).toEqual({
    ...saved,
    activeSectionId: 'authored',
    foldedGroups: [],
  });
  expect(await getItem('panelState')).not.toHaveProperty('filterQuery');
  await setItems({ auth: buildAuth('hubot') });
  expect(activeSectionId.value).toBeUndefined();
  expect(foldedGroups.value).toEqual([]);
  expect(filterQuery.value).toBe('');
  expect(showHidden.value).toBe(false);
  await signOut();
  expect(await getItem('panelState')).toBeUndefined();
  await selectSection('authored');
  expect(await getItem('panelState')).toBeUndefined();
});

it('repairs malformed or excessive stored view context', () => {
  expect(normalizePanelState({ login: '../bad' })).toBeUndefined();
  expect(normalizePanelState(undefined)).toBeUndefined();
  expect(
    normalizePanelState({
      login: 'Octocat',
      activeSectionId: '../bad',
      foldedGroups: ['a\nb', 'a\nb', 5, 'x'.repeat(300)],
    }),
  ).toEqual({ login: 'octocat', foldedGroups: ['a\nb'] });
});
