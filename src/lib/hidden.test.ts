import { describe, expect, it } from 'vitest';
import { buildPullRequest } from '../test/panel';
import { describeHiddenReasons, hiddenReasons } from './hidden';
import { DEFAULT_SETTINGS } from './storage/settings';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 86_400_000;
const committed = (msAgo: number) =>
  buildPullRequest({ lastCommitAt: new Date(NOW - msAgo).toISOString() });

describe('hiddenReasons', () => {
  it('hides a pull request whose last commit is older than 20 days by default', () => {
    expect(hiddenReasons(committed(20 * DAY + 1), DEFAULT_SETTINGS, NOW)).toEqual([
      { kind: 'stale', days: 20 },
    ]);
    expect(hiddenReasons(committed(34.9 * DAY), DEFAULT_SETTINGS, NOW)).toEqual([
      { kind: 'stale', days: 34 },
    ]);
  });

  it('shows one committed within the limit, or in the future of a wrong clock', () => {
    expect(hiddenReasons(committed(20 * DAY), DEFAULT_SETTINGS, NOW)).toEqual([]);
    expect(hiddenReasons(committed(0), DEFAULT_SETTINGS, NOW)).toEqual([]);
    expect(hiddenReasons(committed(-3 * DAY), DEFAULT_SETTINGS, NOW)).toEqual([]);
  });

  it('follows the setting, and never hides with 0', () => {
    const pr = committed(400 * DAY);
    expect(hiddenReasons(pr, { hideStaleAfterDays: 365 }, NOW)).toEqual([
      { kind: 'stale', days: 400 },
    ]);
    expect(hiddenReasons(committed(2 * DAY), { hideStaleAfterDays: 1 }, NOW)).toHaveLength(1);
    expect(hiddenReasons(pr, { hideStaleAfterDays: 0 }, NOW)).toEqual([]);
  });

  it('shows a pull request stored before the date was fetched', () => {
    // Snapshots written by an older version have no `lastCommitAt` until the next poll.
    const pr = buildPullRequest();
    Reflect.deleteProperty(pr, 'lastCommitAt');
    expect(hiddenReasons(pr, DEFAULT_SETTINGS, NOW)).toEqual([]);
  });
});

describe('describeHiddenReasons', () => {
  it('says how long there has been no commit', () => {
    expect(describeHiddenReasons([{ kind: 'stale', days: 34 }])).toBe('No commit for 34 d');
    expect(describeHiddenReasons([])).toBe('');
  });
});
