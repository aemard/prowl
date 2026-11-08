import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prId, prNode, searchResponse } from '../../tests/fixtures/github';
import { defaultSettings } from '../lib/storage/settings';
import { getItems, setItem } from '../lib/storage/storage';
import { signOut as panelSignOut } from '../sidepanel/state/session';
import { poll } from './poller';
import { github, NOW, signIn, teamCalls } from './poller.test-support';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});
it('coalesces scope changes and team refreshes made during a poll into one run', async () => {
  let start = () => {};
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const requests = github(async (query) => {
    if (first) {
      first = false;
      start();
      await gate;
    }
    return searchResponse([prNode({ number: query?.includes('user-review-requested') ? 2 : 1 })]);
  });
  await signIn();
  const initial = poll();
  await started;
  await setItem('settings', {
    ...defaultSettings(),
    sections: defaultSettings().sections.map((section) => ({
      ...section,
      enabled: section.kind === 'authored' || section.kind === 'review_requested',
    })),
  });
  const following = poll({ force: true, afterCurrent: true });
  expect(poll({ force: true, afterCurrent: true })).toBe(following);
  // A team refresh asked meanwhile joins the same trailing run.
  expect(poll({ refreshTeams: true })).toBe(following);
  release();
  await initial;
  const result = await following;
  expect(requests.filter(({ operation }) => operation === 'ProwlSearch')).toHaveLength(3);
  expect(teamCalls).toBe(2);
  expect(result?.snapshot.sections.review_requested).toEqual([prId(2)]);
});

it('serializes snapshot publication with sign-out', async () => {
  github();
  await signIn();
  let entered = () => {};
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = chrome.storage.local.set.bind(chrome.storage.local);
  let blocked = false;
  vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
    if ('snapshot' in items && !blocked) {
      blocked = true;
      entered();
      await gate;
    }
    return original(items);
  });
  const refreshing = poll();
  await writing;
  const signingOut = panelSignOut();
  release();
  await Promise.all([refreshing, signingOut]);
  expect(await getItems(['auth', 'snapshot', 'teams', 'pollState'])).toEqual({});
});
