import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prNode, searchResponse, teamJson } from '../../tests/fixtures/github';
import { jsonResponse } from '../../tests/fixtures/http';
import { defaultSettings } from '../lib/storage/settings';
import { getItem, setItem } from '../lib/storage/storage';
import { poll } from './poller';
import {
  at,
  github,
  later,
  MINUTE,
  NOW,
  PR,
  pollState,
  signIn,
  teamCalls,
} from './poller.test-support';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

const HOUR = 60 * MINUTE;

const followTeams = () =>
  setItem('settings', {
    ...defaultSettings(),
    sections: defaultSettings().sections.map((section) => ({
      ...section,
      enabled: section.kind === 'team_review_requested',
    })),
  });

it('poll teams discovers them on the first poll, searches them, and refreshes them a day later', async () => {
  const requests = github(
    () => searchResponse([prNode()]),
    () => jsonResponse([teamJson('acme/core', 'Core')]),
  );
  await followTeams();
  await signIn();
  await poll();

  expect(teamCalls).toBe(1);
  expect(await getItem('teams')).toEqual({
    login: 'octocat',
    fetchedAt: at(NOW),
    teams: [{ org: 'acme', slug: 'core', name: 'Core' }],
    error: null,
  });
  expect(requests.map(({ query }) => query)).toEqual([
    'is:pr is:open team-review-requested:acme/core archived:false sort:updated-desc',
  ]);
  expect(await getItem('snapshot')).toMatchObject({
    sections: { team_review_requested: [PR] },
    teamRequests: { [PR]: ['acme/core'] },
    sectionErrors: {},
  });

  later(23 * HOUR);
  await poll();
  expect(teamCalls).toBe(1);
  later(HOUR);
  await poll();
  expect(teamCalls).toBe(2);
});

it('poll teams reports a missing scope in the section, not as a poll failure, and retries hourly', async () => {
  github(undefined, () => jsonResponse({ message: 'Not Found' }, { status: 404 }));
  await followTeams();
  await signIn();
  await poll();

  expect(await pollState()).toMatchObject({ lastError: null, consecutiveFailures: 0 });
  expect((await getItem('teams'))?.error?.kind).toBe('missing_scope');
  expect((await getItem('snapshot'))?.sectionErrors?.team_review_requested).toMatch(/read:org/);
  later(59 * MINUTE);
  await poll();
  expect(teamCalls).toBe(1);
  later(MINUTE);
  await poll();
  expect(teamCalls).toBe(2);
});

it('poll teams fails the poll when the discovery cannot reach GitHub, and stores no team', async () => {
  const requests = github(undefined, () => {
    throw new TypeError('Failed to fetch');
  });
  await signIn();
  await poll();
  expect(requests).toEqual([]);
  expect(await pollState()).toMatchObject({ lastError: { kind: 'network' } });
  expect(await getItem('teams')).toBeUndefined();
});

it('poll teams discovers them again on request, in a poll of its own after the one in flight', async () => {
  const requests = github();
  await signIn();
  await poll();
  expect(teamCalls).toBe(1);

  const [shared, refreshed] = await Promise.all([poll(), poll({ refreshTeams: true })]);
  expect(teamCalls).toBe(2);
  expect(requests).toHaveLength(3);
  expect(refreshed).not.toBe(shared);
  expect(refreshed?.snapshot).toBeDefined();
});
