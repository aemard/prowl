import { describe, expect, it } from 'vitest';
import { headCommit, prNode, viewerNode } from '../../../tests/fixtures/github';
import { mapPullRequest } from '../github/mapPullRequest';
import type { BadgeMode, PrLocalState, PullRequest, Snapshot } from '../model';
import { emptyPrLocal, markSeen, mute, snooze } from '../storage/prLocal';
import { DEFAULT_SETTINGS } from '../storage/settings';
import { BADGE_TITLE, computeBadge, NO_BADGE } from './computeBadge';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const HOUR = 3_600_000;

type Node = Parameters<typeof prNode>[0];

/** An open PR with passing checks that is blocked on review: it needs nothing. */
const quiet = (number: number, overrides: Node = {}) =>
  mapPullRequest(prNode({ number, ...overrides }));
const failing = (number: number) => quiet(number, { commits: headCommit({ FAILURE: 1 }) });
const changes = (number: number) => quiet(number, { reviewDecision: 'CHANGES_REQUESTED' });
const conflicting = (number: number) => quiet(number, { mergeable: 'CONFLICTING' });
const ready = (number: number) => quiet(number, { mergeStateStatus: 'CLEAN' });

function snapshot(prs: PullRequest[], sections = { authored: prs.map(({ id }) => id) }): Snapshot {
  return {
    fetchedAt: '2026-10-06T11:59:00Z',
    viewer: viewerNode(),
    pullRequests: Object.fromEntries(prs.map((pr) => [pr.id, pr])),
    sections,
  };
}

const badge = (prs: PullRequest[], mode: BadgeMode = 'attention', local = emptyPrLocal()) =>
  computeBadge(snapshot(prs), local, mode, DEFAULT_SETTINGS, NOW);

describe('computeBadge: attention', () => {
  it('counts failing CI, requested changes, conflicts and ready to merge, not quiet PRs', () => {
    const view = badge([failing(1), changes(2), conflicting(3), ready(4), quiet(5)]);
    expect(view).toEqual({
      text: '4',
      title:
        'Prowl: 4 pull requests needing attention (1 CI failing, 1 changes requested, 1 conflicts, 1 ready to merge)',
      danger: true,
    });
  });

  it('counts a PR once however many reasons it has, and lists each reason', () => {
    const both = quiet(1, {
      commits: headCommit({ FAILURE: 1 }),
      reviewDecision: 'CHANGES_REQUESTED',
    });
    expect(badge([both, ready(2)])).toMatchObject({
      text: '2',
      title:
        'Prowl: 2 pull requests needing attention (1 CI failing, 1 changes requested, 1 ready to merge)',
    });
  });

  it('is accent, not danger, unless CI fails or changes are requested', () => {
    expect(badge([conflicting(1), ready(2)])).toMatchObject({ text: '2', danger: false });
    expect(badge([changes(1), ready(2)]).danger).toBe(true);
    expect(badge([failing(1)]).danger).toBe(true);
  });

  it('says "1 pull request" in the singular', () => {
    expect(badge([ready(1)]).title).toBe(
      'Prowl: 1 pull request needing attention (1 ready to merge)',
    );
  });

  it('shows nothing when nothing needs attention', () => {
    expect(badge([quiet(1), quiet(2)])).toEqual(NO_BADGE);
    expect(badge([])).toEqual({ text: '', title: BADGE_TITLE, danger: false });
  });

  it('ignores merged and closed PRs even when a section holds them', () => {
    const merged = quiet(1, { state: 'MERGED', commits: headCommit({ FAILURE: 1 }) });
    expect(badge([merged, quiet(2, { state: 'CLOSED', mergeable: 'CONFLICTING' })])).toEqual(
      NO_BADGE,
    );
  });

  it('counts only PRs that are in a section, and each one once', () => {
    const [a, b, c] = [failing(1), failing(2), failing(3)] as [
      PullRequest,
      PullRequest,
      PullRequest,
    ];
    const sections = { authored: [a.id, b.id], assigned: [b.id], custom: ['PR_gone'] };
    const view = computeBadge(
      snapshot([a, b, c], sections),
      emptyPrLocal(),
      'attention',
      DEFAULT_SETTINGS,
      NOW,
    );
    expect(view.text).toBe('2');
  });

  it('excludes snoozed PRs until the snooze ends, but not muted ones', () => {
    const [a, b] = [failing(1), failing(2)] as [PullRequest, PullRequest];
    let local: PrLocalState = snooze(emptyPrLocal(), a.id, NOW + HOUR);
    local = mute(local, b.id);
    expect(badge([a, b], 'attention', local).text).toBe('1');
    expect(
      computeBadge(snapshot([a, b]), local, 'attention', DEFAULT_SETTINGS, NOW + 2 * HOUR).text,
    ).toBe('2');
  });

  it('leaves out PRs the list hides, under the same setting', () => {
    const stale = quiet(1, { commits: headCommit({ FAILURE: 1 }, {}, '2026-09-10T12:00:00Z') });
    const [old, recent] = [stale, failing(2)] as [PullRequest, PullRequest];
    expect(badge([old, recent])).toMatchObject({
      text: '1',
      title: 'Prowl: 1 pull request needing attention (1 CI failing)',
    });
    expect(badge([old], 'unseen')).toEqual(NO_BADGE);
    const never = { ...DEFAULT_SETTINGS, hideStaleAfterDays: 0 };
    expect(
      computeBadge(snapshot([old, recent]), emptyPrLocal(), 'attention', never, NOW).text,
    ).toBe('2');
  });

  it('leaves out drafts and bots when the list does, and counts them otherwise', () => {
    const draft = quiet(1, { isDraft: true, commits: headCommit({ FAILURE: 1 }) });
    const bot = quiet(2, {
      author: { __typename: 'Bot', login: 'dependabot', avatarUrl: 'a' },
      commits: headCommit({ FAILURE: 1 }),
    });
    const prs = [draft, bot, failing(3)];
    const count = (hide: Partial<typeof DEFAULT_SETTINGS>, mode: BadgeMode = 'attention') =>
      computeBadge(snapshot(prs), emptyPrLocal(), mode, { ...DEFAULT_SETTINGS, ...hide }, NOW).text;

    expect(count({})).toBe('3');
    expect(count({ hideDrafts: true })).toBe('2');
    expect(count({ hideBots: true })).toBe('2');
    expect(count({ hideDrafts: true, hideBots: true })).toBe('1');
    expect(count({ hideDrafts: true, hideBots: true }, 'unseen')).toBe('1');
  });

  it('shows 99+ above 99', () => {
    const many = Array.from({ length: 100 }, (_, i) => failing(i + 1));
    expect(badge(many.slice(0, 99)).text).toBe('99');
    expect(badge(many).text).toBe('99+');
  });
});

describe('computeBadge: unseen', () => {
  it('counts PRs updated since they were seen, whatever their state', () => {
    const [a, b, c] = [quiet(1), quiet(2), quiet(3, { state: 'MERGED' })] as [
      PullRequest,
      PullRequest,
      PullRequest,
    ];
    let local = markSeen(emptyPrLocal(), a.id, a.updatedAt);
    local = markSeen(local, b.id, '2026-10-04T00:00:00Z');
    expect(badge([a, b, c], 'unseen', local)).toEqual({
      text: '2',
      title: 'Prowl: 2 pull requests with unseen changes',
      danger: false,
    });
    expect(badge([a], 'unseen', local)).toEqual(NO_BADGE);
    expect(badge([b], 'unseen', local).title).toBe('Prowl: 1 pull request with unseen changes');
  });

  it('counts a PR that was never seen and skips snoozed ones', () => {
    const [a, b] = [quiet(1), quiet(2)] as [PullRequest, PullRequest];
    expect(badge([a, b], 'unseen').text).toBe('2');
    expect(badge([a, b], 'unseen', snooze(emptyPrLocal(), a.id, NOW + HOUR)).text).toBe('1');
  });

  it('is danger only when a counted PR is failing or has requested changes', () => {
    const [seen, unseen] = [failing(1), quiet(2)] as [PullRequest, PullRequest];
    const local = markSeen(emptyPrLocal(), seen.id, seen.updatedAt);
    expect(badge([seen, unseen], 'unseen', local).danger).toBe(false);
    expect(badge([seen, unseen], 'unseen').danger).toBe(true);
  });
});

describe('computeBadge: off and signed out', () => {
  it('shows nothing', () => {
    expect(badge([failing(1)], 'off')).toEqual(NO_BADGE);
    expect(computeBadge(undefined, emptyPrLocal(), 'attention', DEFAULT_SETTINGS, NOW)).toEqual(
      NO_BADGE,
    );
  });
});
