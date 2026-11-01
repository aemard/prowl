import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { headCommit, prNode, searchResponse } from '../../tests/fixtures/github';
import type { CheckState } from '../lib/model';
import { defaultSettings } from '../lib/storage/settings';
import { getItem, setItem } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { BADGE_COLORS } from './badge';
import { poll } from './poller';
import {
  CHECKS,
  fail,
  github,
  later,
  MINUTE,
  NOW,
  PR,
  searchWith,
  signIn,
} from './poller.test-support';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

it('poll reports what changed since the previous poll, across pending checks', async () => {
  let checks: CheckState = 'failure';
  github(() => searchWith(checks)());
  await signIn();
  expect((await poll())?.events).toEqual([]);

  const types = async (next: CheckState) => {
    checks = next;
    later(2 * MINUTE);
    return (await poll())?.events.map(({ type }) => type);
  };
  expect(await types('pending')).toEqual([]);
  expect((await getItem('snapshot'))?.settledChecks).toEqual({ [PR]: 'failure' });
  expect(await types('success')).toEqual(['ci_passed']);
  expect(await types('pending')).toEqual([]);
  expect(await types('success')).toEqual([]);
  expect(await types('failure')).toEqual(['ci_failed']);
});

it('poll updates the badge once the poll has stored its snapshot', async () => {
  let checks: CheckState = 'failure';
  github(() => searchWith(checks)());
  await signIn();
  await poll();
  expect(fakeChrome().__state.badge).toMatchObject({ text: '1', color: BADGE_COLORS.danger });

  checks = 'success';
  later(2 * MINUTE);
  await poll();
  expect(fakeChrome().__state.badge).toMatchObject({ text: '', title: 'Prowl' });
});

it('poll leaves the badge alone when the poll fails', async () => {
  github(fail(500, 'boom'));
  await signIn();
  await chrome.action.setBadgeText({ text: '3' });
  await poll();
  expect(fakeChrome().__state.badge.text).toBe('3');
});

it('poll does not notify on the first poll after sign-in', async () => {
  github(searchWith('failure'));
  await signIn();
  expect(await poll()).toMatchObject({ events: [] });
});

it('poll notifies about what changed, once, unless the PR is muted', async () => {
  let checks: CheckState = 'pending';
  github(() => searchWith(checks)());
  await setItem('settings', {
    ...defaultSettings(),
    ...(await getItem('settings')),
    notifications: { ...defaultSettings().notifications, enabled: true },
  });
  await signIn();
  await poll();
  expect(fakeChrome().__state.notifications.size).toBe(0);

  checks = 'failure';
  later(2 * MINUTE);
  await poll();
  const { notifications } = fakeChrome().__state;
  expect([...notifications.keys()]).toEqual([`${PR}:ci_failed:${'a'.repeat(40)}`]);
  expect([...notifications.values()][0]?.options).toMatchObject({ title: 'CI failed' });

  // Back to pending and failing again on the same commit: the id is the same.
  notifications.clear();
  for (const next of ['pending', 'failure'] as const) {
    checks = next;
    later(2 * MINUTE);
    await poll();
  }
  expect(notifications.size).toBe(0);

  // A muted PR is silent, and so is a type switched off.
  await setItem('prLocal', { snoozed: {}, muted: { [PR]: true }, seen: {} });
  await setItem('settings', {
    ...defaultSettings(),
    notifications: {
      ...defaultSettings().notifications,
      enabled: true,
      events: { ...defaultSettings().notifications.events, ci_passed: false },
    },
  });
  for (const next of ['success', 'pending', 'failure'] as const) {
    checks = next;
    later(2 * MINUTE);
    await poll();
  }
  expect(notifications.size).toBe(0);
});

it('poll still notifies about a PR the list hides for its old last commit, kept off the badge', async () => {
  let checks: CheckState = 'pending';
  const lastCommit = new Date(NOW - 35 * 24 * 60 * MINUTE).toISOString();
  github(() => searchResponse([prNode({ commits: headCommit(CHECKS[checks], {}, lastCommit) })]));
  await setItem('settings', {
    ...defaultSettings(),
    ...(await getItem('settings')),
    notifications: { ...defaultSettings().notifications, enabled: true },
  });
  await signIn();
  await poll();
  checks = 'failure';
  later(2 * MINUTE);
  await poll();
  const { notifications, badge } = fakeChrome().__state;
  expect([...notifications.keys()]).toEqual([`${PR}:ci_failed:${'a'.repeat(40)}`]);
  expect(badge.text).toBe('');
});

it('poll still notifies about a draft opened by a bot when the list hides both', async () => {
  await setItem('settings', { ...defaultSettings(), hideDrafts: true, hideBots: true });
  let checks: CheckState = 'pending';
  const dependabot = { __typename: 'Bot', login: 'dependabot', avatarUrl: 'a' };
  github(() =>
    searchResponse([
      prNode({ isDraft: true, author: dependabot, commits: headCommit(CHECKS[checks]) }),
    ]),
  );
  await setItem('settings', {
    ...defaultSettings(),
    ...(await getItem('settings')),
    notifications: { ...defaultSettings().notifications, enabled: true },
  });
  await signIn();
  await poll();
  checks = 'failure';
  later(2 * MINUTE);
  await poll();
  const { notifications, badge } = fakeChrome().__state;
  expect([...notifications.keys()]).toEqual([`${PR}:ci_failed:${'a'.repeat(40)}`]);
  expect(badge.text).toBe('');
});

it('poll keeps the poll result when notifying fails', async () => {
  let checks: CheckState = 'pending';
  github(() => searchWith(checks)());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(chrome.notifications, 'create').mockRejectedValue(new Error('no display'));
  await signIn();
  await poll();
  checks = 'failure';
  later(2 * MINUTE);
  expect((await poll())?.events).toHaveLength(1);
});
