import { effect } from '@preact/signals';
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

it('restores the saved section and folds, stores new ones and drops them with the account', async () => {
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

it('does not replay its own writes over newer choices', async () => {
  await setItems({ auth: buildAuth() });
  stop = await hydrateStore();
  const states: string[] = [];
  const stopWatching = effect(() => {
    states.push(`${activeSectionId.value}:${foldedGroups.value.join(',')}`);
  });
  await Promise.all([
    selectSection('a'),
    selectSection('b'),
    toggleFolded('b\nx/y'),
    toggleFolded('b\nx/z'),
  ]);
  stopWatching();
  expect(states).toEqual(['undefined:', 'a:', 'b:', 'b:b\nx/y', 'b:b\nx/y,b\nx/z']);
  expect((await getItem('panelState'))?.foldedGroups).toEqual(['b\nx/y', 'b\nx/z']);
});

it('stores a fold as it shows it, even when another window changed it meanwhile', async () => {
  const key = foldKey('authored', 'acme/web');
  await setItems({ auth: buildAuth(), panelState: { login: 'octocat', foldedGroups: [] } });
  stop = await hydrateStore();
  await setItems({ panelState: { login: 'octocat', foldedGroups: [key] } });
  await toggleFolded(key);
  expect(foldedGroups.value).toEqual([key]);
  expect((await getItem('panelState'))?.foldedGroups).toEqual([key]);
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
  // A Managed User's login has an underscore: it must not make the context unreadable.
  expect(normalizePanelState({ login: 'Octocat_Acme', foldedGroups: [] })?.login).toBe(
    'octocat_acme',
  );
});
