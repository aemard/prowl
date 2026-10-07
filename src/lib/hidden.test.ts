import { describe, expect, it } from 'vitest';
import { buildPullRequest } from '../test/panel';
import { describeHiddenReasons, hiddenReasons } from './hidden';
import { DEFAULT_SETTINGS } from './storage/settings';

const BY_BOT = { login: 'dependabot', avatarUrl: '', isBot: true };
const HIDE_ALL = { hideDrafts: true, hideBots: true, hideStaleAfterDays: 20 };
const NEVER_STALE = { ...DEFAULT_SETTINGS, hideStaleAfterDays: 0 };

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
    expect(hiddenReasons(pr, { ...DEFAULT_SETTINGS, hideStaleAfterDays: 365 }, NOW)).toEqual([
      { kind: 'stale', days: 400 },
    ]);
    expect(
      hiddenReasons(committed(2 * DAY), { ...DEFAULT_SETTINGS, hideStaleAfterDays: 1 }, NOW),
    ).toHaveLength(1);
    expect(hiddenReasons(pr, NEVER_STALE, NOW)).toEqual([]);
  });

  it('shows a pull request stored before the date was fetched', () => {
    // Snapshots written by an older version have no `lastCommitAt` until the next poll.
    const pr = buildPullRequest();
    Reflect.deleteProperty(pr, 'lastCommitAt');
    expect(hiddenReasons(pr, DEFAULT_SETTINGS, NOW)).toEqual([]);
  });
});

describe('hiddenReasons: drafts and bots', () => {
  const draft = buildPullRequest({ isDraft: true });
  const bot = buildPullRequest({ author: BY_BOT });

  it('shows both by default', () => {
    expect(hiddenReasons(draft, DEFAULT_SETTINGS, NOW)).toEqual([]);
    expect(hiddenReasons(bot, DEFAULT_SETTINGS, NOW)).toEqual([]);
  });

  it('hides a draft with hideDrafts, and only a draft', () => {
    const hide = { ...DEFAULT_SETTINGS, hideDrafts: true };
    expect(hiddenReasons(draft, hide, NOW)).toEqual([{ kind: 'draft' }]);
    expect(hiddenReasons(bot, hide, NOW)).toEqual([]);
    expect(hiddenReasons(buildPullRequest(), hide, NOW)).toEqual([]);
  });

  it('hides a PR opened by a bot with hideBots, and only that', () => {
    const hide = { ...DEFAULT_SETTINGS, hideBots: true };
    expect(hiddenReasons(bot, hide, NOW)).toEqual([{ kind: 'bot' }]);
    expect(hiddenReasons(draft, hide, NOW)).toEqual([]);
    // A deleted author is nobody's bot, and a snapshot stored before `isBot` has none.
    expect(hiddenReasons(buildPullRequest({ author: null }), hide, NOW)).toEqual([]);
    const old = buildPullRequest({ author: { ...BY_BOT } });
    Reflect.deleteProperty(old.author ?? {}, 'isBot');
    expect(hiddenReasons(old, hide, NOW)).toEqual([]);
  });

  it('lists every reason that applies, drafts first, and each switch alone is enough', () => {
    const all = buildPullRequest({
      isDraft: true,
      author: BY_BOT,
      lastCommitAt: new Date(NOW - 34 * DAY).toISOString(),
    });
    expect(hiddenReasons(all, HIDE_ALL, NOW)).toEqual([
      { kind: 'draft' },
      { kind: 'bot' },
      { kind: 'stale', days: 34 },
    ]);
    expect(hiddenReasons(all, { ...HIDE_ALL, hideDrafts: false }, NOW)).toHaveLength(2);
    expect(hiddenReasons(all, { ...HIDE_ALL, hideBots: false }, NOW)).toHaveLength(2);
    expect(hiddenReasons(all, { ...HIDE_ALL, hideStaleAfterDays: 0 }, NOW)).toHaveLength(2);
    expect(hiddenReasons(all, NEVER_STALE, NOW)).toEqual([]);
  });
});

describe('describeHiddenReasons', () => {
  it('says how long there has been no commit', () => {
    expect(describeHiddenReasons([{ kind: 'stale', days: 34 }])).toBe('No commit for 34 d');
    expect(describeHiddenReasons([])).toBe('');
  });

  it("names a bot, joins the reasons, and leaves a draft to the card's own Draft chip", () => {
    expect(describeHiddenReasons([{ kind: 'bot' }])).toBe('Bot');
    expect(describeHiddenReasons([{ kind: 'draft' }])).toBe('');
    expect(
      describeHiddenReasons([{ kind: 'draft' }, { kind: 'bot' }, { kind: 'stale', days: 34 }]),
    ).toBe('Bot, No commit for 34 d');
  });
});
