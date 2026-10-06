import { describe, expect, it } from 'vitest';
import { prNode, viewerNode } from '../../../tests/fixtures/github';
import { mapPullRequest } from '../github/mapPullRequest';
import type { CheckState, PrEventType, PullRequest, Review, Snapshot } from '../model';
import { diffSnapshots, isReadyToMerge } from './diffSnapshots';

const VIEWER = 'octocat';
const FETCHED_AT = '2026-10-06T09:00:00.000Z';
const YESTERDAY = '2026-10-05T08:00:00Z';
const REVIEWED = '2026-10-06T08:00:00Z';
const COMMENTED = '2026-10-06T08:30:00Z';
const CLOSED = '2026-10-06T08:45:00Z';
const SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);

/** Open, checks passing, review required, mergeable but `blocked`: not ready to merge. */
const base = mapPullRequest(prNode());
const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({ ...base, ...overrides });
const ci = (state: CheckState, headSha = SHA): Partial<PullRequest> => ({
  checks: { ...base.checks, state },
  headSha,
});
const review = (author: string, state: Review['state'], submittedAt = REVIEWED): Review => ({
  id: `PRR_${author}_${state}`,
  author,
  state,
  submittedAt,
});
const reviews = (...list: Review[]) => ({ reviews: list });
const comments = (commentCount: number, author?: string, createdAt = COMMENTED) => ({
  commentCount,
  lastComment: author ? { author, createdAt } : null,
});
const ready = (overrides: Partial<PullRequest> = {}): Partial<PullRequest> => ({
  mergeStateStatus: 'clean',
  ...overrides,
});
const ended = (state: 'merged' | 'closed', closedBy: string | null): Partial<PullRequest> => ({
  state,
  closedBy,
  updatedAt: CLOSED,
});

function snapshot(prs: PullRequest[], fetchedAt = FETCHED_AT, login = VIEWER): Snapshot {
  return {
    fetchedAt,
    viewer: viewerNode({ login }),
    pullRequests: Object.fromEntries(prs.map((p) => [p.id, p])),
    sections: { authored: prs.map(({ id }) => id) },
  };
}

/** `actor` defaults to null and `at` to the poll time. */
type Expected = [type: PrEventType, actor?: string | null, at?: string];
type Case = [name: string, before: Partial<PullRequest>, after: Partial<PullRequest>, Expected[]];

const cases: Case[] = [
  // CI
  ['ci_failed: success -> failure', ci('success'), ci('failure'), [['ci_failed']]],
  ['ci_failed: pending -> failure', ci('pending'), ci('failure'), [['ci_failed']]],
  ['ci_failed: none -> failure', ci('none'), ci('failure'), [['ci_failed']]],
  [
    'ci_failed: a new head commit fails too',
    ci('failure'),
    ci('failure', NEW_SHA),
    [['ci_failed']],
  ],
  ['nothing: still failing on the same commit', ci('failure'), ci('failure'), []],
  ['ci_passed: failure -> success', ci('failure'), ci('success'), [['ci_passed']]],
  ['ci_passed: a new head commit passes', ci('failure'), ci('success', NEW_SHA), [['ci_passed']]],
  ['nothing: pending -> success', ci('pending'), ci('success'), []],
  ['nothing: failure -> pending', ci('failure'), ci('pending'), []],
  ['nothing: failure -> none', ci('failure'), ci('none', NEW_SHA), []],
  // Reviews
  ['approved', {}, reviews(review('hubot', 'approved')), [['approved', 'hubot', REVIEWED]]],
  [
    'changes_requested',
    {},
    reviews(review('hubot', 'changes_requested')),
    [['changes_requested', 'hubot', REVIEWED]],
  ],
  [
    'review_new: commented',
    {},
    reviews(review('hubot', 'commented')),
    [['review_new', 'hubot', REVIEWED]],
  ],
  ['nothing: a new review already dismissed', {}, reviews(review('hubot', 'dismissed')), []],
  ["nothing: the viewer's own review", {}, reviews(review(VIEWER, 'approved')), []],
  ['nothing: viewer matched case-insensitively', {}, reviews(review('OctoCat', 'commented')), []],
  [
    'nothing: a known review id',
    reviews(review('hubot', 'approved')),
    reviews(review('hubot', 'approved')),
    [],
  ],
  [
    'nothing: a known review that got dismissed',
    reviews(review('hubot', 'approved')),
    reviews({ ...review('hubot', 'approved'), state: 'dismissed' }),
    [],
  ],
  [
    'one event per new review, by time',
    reviews(review('monalisa', 'commented', YESTERDAY)),
    reviews(
      review('hubot', 'changes_requested', '2026-10-06T08:10:00Z'),
      review('monalisa', 'approved', '2026-10-06T08:05:00Z'),
      review('monalisa', 'commented', YESTERDAY),
    ),
    [
      ['approved', 'monalisa', '2026-10-06T08:05:00Z'],
      ['changes_requested', 'hubot', '2026-10-06T08:10:00Z'],
    ],
  ],
  // Comments
  [
    'comment_new by someone else',
    comments(1, 'hubot', YESTERDAY),
    comments(2, 'monalisa'),
    [['comment_new', 'monalisa', COMMENTED]],
  ],
  [
    'comment_new: the first comment',
    comments(0),
    comments(1, 'hubot'),
    [['comment_new', 'hubot', COMMENTED]],
  ],
  ["nothing: the viewer's own comment", comments(1, 'hubot', YESTERDAY), comments(2, VIEWER), []],
  ['nothing: review comments, same latest comment', comments(1, 'hubot'), comments(3, 'hubot'), []],
  ['nothing: review comments, no issue comment', comments(0), comments(2), []],
  [
    'nothing: count unchanged (deleted + added)',
    comments(2, 'hubot', YESTERDAY),
    comments(2, 'monalisa'),
    [],
  ],
  // Ready to merge
  ['ready_to_merge: mergeStateStatus clean', {}, ready(), [['ready_to_merge']]],
  [
    'ready_to_merge: approved, checks pass, mergeable',
    {},
    { reviewDecision: 'approved' },
    [['ready_to_merge']],
  ],
  [
    'ready_to_merge: no review needed, no checks',
    {},
    { reviewDecision: 'none', ...ci('none') },
    [['ready_to_merge']],
  ],
  [
    'ready_to_merge: draft marked ready',
    { isDraft: true, mergeStateStatus: 'draft' },
    ready(),
    [['ready_to_merge']],
  ],
  ['nothing: still ready', ready(), ready({ headSha: NEW_SHA }), []],
  ['nothing: draft', {}, { isDraft: true, reviewDecision: 'approved' }, []],
  ['nothing: approved, checks pending', {}, { reviewDecision: 'approved', ...ci('pending') }, []],
  [
    'only ci_failed: approved, checks failing',
    {},
    { reviewDecision: 'approved', ...ci('failure') },
    [['ci_failed']],
  ],
  [
    'nothing: approved, conflicting',
    {},
    { reviewDecision: 'approved', mergeable: 'conflicting' },
    [],
  ],
  [
    'nothing: approved, mergeable unknown',
    {},
    { reviewDecision: 'approved', mergeable: 'unknown' },
    [],
  ],
  ['nothing: merged while ready', ready(), { ...ready(), ...ended('merged', VIEWER) }, []],
  // Merged / closed
  ['merged by someone else', ready(), ended('merged', 'hubot'), [['merged', 'hubot', CLOSED]]],
  ['closed by someone else', {}, ended('closed', 'hubot'), [['closed', 'hubot', CLOSED]]],
  ['closed by an unknown actor', {}, ended('closed', null), [['closed', null, CLOSED]]],
  ['nothing: merged by the viewer', {}, ended('merged', VIEWER), []],
  ['nothing: closed by the viewer', {}, ended('closed', 'OCTOCAT'), []],
  ['nothing: already merged', ended('merged', 'hubot'), ended('merged', 'hubot'), []],
  ['nothing: unchanged', {}, {}, []],
];

describe('diffSnapshots', () => {
  it.each(cases)('%s', (_name, before, after, expected) => {
    const result = diffSnapshots(snapshot([pr(before)]), snapshot([pr(after)]), VIEWER);
    expect(result.map(({ type, actor, at }) => [type, actor, at])).toEqual(
      expected.map(([type, actor = null, at = FETCHED_AT]) => [type, actor, at]),
    );
  });

  it('builds the event from the next copy of the PR', () => {
    const after = pr({ title: 'Renamed', ...ci('failure') });
    expect(diffSnapshots(snapshot([pr()]), snapshot([after]), VIEWER)).toEqual([
      {
        id: `${base.id}:ci_failed:${SHA}`,
        type: 'ci_failed',
        prId: base.id,
        repo: 'acme/widgets',
        number: 1,
        title: 'Renamed',
        url: 'https://github.com/acme/widgets/pull/1',
        actor: null,
        at: FETCHED_AT,
      },
    ]);
  });

  it('returns nothing without a previous snapshot', () => {
    expect(diffSnapshots(null, snapshot([pr(ci('failure'))]), VIEWER)).toEqual([]);
  });

  it('returns nothing when the previous snapshot belongs to another account', () => {
    const prev = snapshot([pr()], FETCHED_AT, 'hubot');
    expect(diffSnapshots(prev, snapshot([pr(ci('failure'))]), VIEWER)).toEqual([]);
    expect(diffSnapshots(prev, snapshot([pr(ci('failure'))]), 'HUBOT')).toHaveLength(1);
  });

  it('ignores PRs that left the scope and PRs that are new', () => {
    const gone = pr();
    const fresh = pr({ id: 'PR_new', ...ci('failure'), ...reviews(review('hubot', 'approved')) });
    expect(diffSnapshots(snapshot([gone]), snapshot([fresh]), VIEWER)).toEqual([]);
  });

  it('gives a repeated poll of the same change the same ids', () => {
    const prev = snapshot([pr(comments(0))]);
    const after = pr({
      ...ci('failure'),
      ...comments(1, 'hubot'),
      ...reviews(review('hubot', 'approved')),
    });
    const ids = (fetchedAt: string) =>
      diffSnapshots(prev, snapshot([after], fetchedAt), VIEWER).map(({ id }) => id);
    expect(ids(FETCHED_AT)).toEqual(ids('2026-10-06T09:02:00.000Z'));
    expect(new Set(ids(FETCHED_AT)).size).toBe(3);
  });

  it('reports a duplicated review once', () => {
    const twice = [review('hubot', 'approved'), review('hubot', 'approved')];
    expect(
      diffSnapshots(snapshot([pr()]), snapshot([pr({ reviews: twice })]), VIEWER),
    ).toHaveLength(1);
  });

  it('sorts events of every PR by time, oldest first', () => {
    const one = pr();
    const two = pr({ id: 'PR_two', number: 2 });
    const next = snapshot([
      { ...one, ...ci('failure'), ...comments(1, 'hubot') },
      { ...two, ...reviews(review('hubot', 'approved')) },
    ]);
    const events = diffSnapshots(snapshot([one, two]), next, VIEWER);
    expect(events.map(({ type, number }) => [type, number])).toEqual([
      ['approved', 2],
      ['comment_new', 1],
      ['ci_failed', 1],
    ]);
  });
});

describe('isReadyToMerge', () => {
  it('is false once the PR is merged or closed', () => {
    expect(isReadyToMerge(pr(ready()))).toBe(true);
    expect(isReadyToMerge(pr(ready({ state: 'merged' })))).toBe(false);
    expect(isReadyToMerge(pr(ready({ state: 'closed' })))).toBe(false);
  });
});
