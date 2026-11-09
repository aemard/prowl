import { describe, expect, it } from 'vitest';
import type { CheckItem, PullRequest, PullRequestDetail } from '../../lib/model';
import { buildDetail, buildPullRequest } from '../../test/panel';
import { mergeReadiness } from './mergeReadiness';

const check = (name: string, state: CheckItem['state'], required = false): CheckItem => ({
  name,
  state,
  url: null,
  required,
});
const counts = (failed: number, pending = 0) => ({
  state: failed ? ('failure' as const) : ('pending' as const),
  total: failed + pending,
  passed: 0,
  failed,
  pending,
  neutral: 0,
});
const review = (author: string, state: PullRequest['reviews'][number]['state']) => ({
  id: author,
  author,
  state,
  submittedAt: '2026-10-05T10:00:00Z',
});

type Case = [string, Partial<PullRequest>, PullRequestDetail | undefined, string[]];

const CASES: Case[] = [
  ['clean and mergeable', { mergeStateStatus: 'clean' }, undefined, ['Ready to merge']],
  [
    'has_hooks and unstable are still mergeable',
    { mergeStateStatus: 'has_hooks' },
    undefined,
    ['Ready to merge'],
  ],
  ['merged', { state: 'merged', closedBy: 'alice' }, undefined, ['Merged by alice']],
  ['merged by nobody known', { state: 'merged' }, undefined, ['Merged']],
  ['closed', { state: 'closed' }, undefined, ['Closed without merging']],
  [
    'a draft also lists review blockers',
    { isDraft: true, reviewDecision: 'review_required', mergeStateStatus: 'draft' },
    buildDetail(),
    ['Draft', '1 approval needed'],
  ],
  [
    'conflicts name the base branch',
    { mergeable: 'conflicting', mergeStateStatus: 'dirty', baseRefName: 'develop' },
    undefined,
    ['Conflicts with develop'],
  ],
  ['behind the base branch', { mergeStateStatus: 'behind' }, undefined, ['Behind main']],
  [
    'one approval required',
    { reviewDecision: 'review_required' },
    buildDetail({ requiredApprovals: 1 }),
    ['1 approval needed'],
  ],
  [
    'two approvals required',
    { reviewDecision: 'review_required' },
    buildDetail({ requiredApprovals: 2 }),
    ['2 approvals needed'],
  ],
  [
    'one more approval after one',
    { reviewDecision: 'review_required', reviews: [review('bob', 'approved')] },
    buildDetail({ requiredApprovals: 2 }),
    ['1 approval needed'],
  ],
  [
    'a rule that is not visible: just review required',
    { reviewDecision: 'review_required' },
    buildDetail({ requiredApprovals: null }),
    ['Review required'],
  ],
  [
    'review required before the detail loads',
    { reviewDecision: 'review_required' },
    undefined,
    ['Review required'],
  ],
  [
    'changes requested name who asked',
    {
      reviewDecision: 'changes_requested',
      reviews: [
        review('alice', 'changes_requested'),
        review('bob', 'approved'),
        review('carol', 'changes_requested'),
      ],
    },
    undefined,
    ['Changes requested by alice, carol'],
  ],
  [
    'changes requested by someone unknown',
    { reviewDecision: 'changes_requested' },
    undefined,
    ['Changes requested'],
  ],
  [
    'required failing checks, counted from the detail',
    { checks: counts(3), mergeStateStatus: 'blocked' },
    buildDetail({
      checks: [check('a', 'failed', true), check('b', 'failed'), check('c', 'failed', true)],
    }),
    ['2 required checks failed'],
  ],
  [
    'failing checks that are not required do not block',
    { checks: counts(1), mergeStateStatus: 'unstable' },
    buildDetail({ checks: [check('a', 'failed')] }),
    ['Ready to merge', '1 optional check failed'],
  ],
  [
    'failing checks before the detail loads block unless GitHub says unstable',
    { checks: counts(2), mergeStateStatus: 'blocked' },
    undefined,
    ['2 checks failed'],
  ],
  [
    'unstable without a detail: not required',
    { checks: counts(2), mergeStateStatus: 'unstable' },
    undefined,
    ['Ready to merge', '2 optional checks failed'],
  ],
  [
    'a detail with no checks (unreadable) falls back to the counts',
    { checks: counts(1), mergeStateStatus: 'blocked' },
    buildDetail({ checks: [] }),
    ['1 check failed'],
  ],
  [
    'waiting for required checks',
    { checks: counts(0, 2), mergeStateStatus: 'blocked' },
    buildDetail({
      checks: [check('a', 'pending', true), check('b', 'pending'), check('c', 'pending', true)],
    }),
    ['2 required checks running'],
  ],
  [
    'pending checks while blocked, before the detail loads',
    { checks: counts(0, 1), mergeStateStatus: 'blocked' },
    undefined,
    ['1 check running'],
  ],
  [
    'pending checks that block nothing',
    { checks: counts(0, 1), mergeStateStatus: 'clean' },
    undefined,
    ['Ready to merge'],
  ],
  [
    'unresolved conversations when the branch requires them resolved',
    { unresolvedThreads: 2 },
    buildDetail({ requiresConversationResolution: true }),
    ['2 conversations to resolve'],
  ],
  [
    'unresolved conversations that nothing requires resolved',
    { unresolvedThreads: 2, mergeStateStatus: 'clean' },
    buildDetail({ requiresConversationResolution: false }),
    ['Ready to merge'],
  ],
  [
    'several blockers, one line each',
    {
      reviewDecision: 'review_required',
      mergeable: 'conflicting',
      checks: counts(1),
      mergeStateStatus: 'dirty',
    },
    buildDetail({ checks: [check('a', 'failed', true)] }),
    ['1 approval needed', 'Conflicts with main', '1 required check failed'],
  ],
  [
    'blocked for a reason GitHub does not tell',
    { mergeStateStatus: 'blocked' },
    buildDetail(),
    ['Blocked by branch rules'],
  ],
  [
    'mergeability still being computed',
    { mergeable: 'unknown', mergeStateStatus: 'unknown' },
    undefined,
    ['Checking merge status…'],
  ],
  [
    'review requirement not read for this commit',
    { reviewDecision: 'unknown' },
    undefined,
    ['Checking merge status…'],
  ],
  [
    'a verdict that cannot merge without a reason to list',
    { mergeStateStatus: 'dirty' },
    undefined,
    ['Blocked by branch rules'],
  ],
];

describe('mergeReadiness', () => {
  it.each(CASES)('%s', (_name, overrides, detail, expected) => {
    const pr = buildPullRequest({ mergeStateStatus: 'clean', ...overrides });
    expect(mergeReadiness(pr, detail).map((line) => line.text)).toEqual(expected);
  });

  it('colors each line by what it is: blockers by kind, the verdict green', () => {
    const tones = (overrides: Partial<PullRequest>, detail?: PullRequestDetail) =>
      mergeReadiness(buildPullRequest({ mergeStateStatus: 'blocked', ...overrides }), detail).map(
        (line) => line.tone,
      );
    expect(tones({ mergeStateStatus: 'clean' })).toEqual(['success']);
    expect(tones({ state: 'merged' })).toEqual(['done']);
    expect(tones({ mergeable: 'conflicting' })).toEqual(['warning']);
    expect(tones({ reviewDecision: 'changes_requested' })).toEqual(['danger']);
    expect(tones({ reviewDecision: 'review_required' })).toEqual(['attention']);
  });
});

it('shows unknown status alongside draft and review blockers, then offers GitHub', () => {
  const pr = buildPullRequest({
    isDraft: true,
    reviewDecision: 'changes_requested',
    mergeable: 'unknown',
  });
  expect(mergeReadiness(pr).map(({ text }) => text)).toEqual([
    'Draft',
    'Changes requested',
    'Checking merge status…',
  ]);
  expect(mergeReadiness(pr, undefined, true).at(-1)).toMatchObject({
    text: 'Merge status unknown',
    link: 'Open on GitHub',
  });
});

it('does not count missing approvals from incomplete reviews', () => {
  const pr = buildPullRequest({ reviewDecision: 'review_required', incomplete: ['reviews'] });
  expect(mergeReadiness(pr, buildDetail({ requiredApprovals: 2 }))[0]?.text).toBe(
    'Review required',
  );
  expect(
    mergeReadiness(
      { ...pr, incomplete: [] },
      buildDetail({ requiredApprovals: 2, warnings: ['Some reviews are not loaded.'] }),
    )[0]?.text,
  ).toBe('Review required');
});

it('keeps blockers when auto-merge is on', () => {
  const pr = buildPullRequest({
    reviewDecision: 'review_required',
    autoMerge: { method: 'squash', enabledBy: 'octocat' },
  });
  expect(mergeReadiness(pr).map(({ text }) => text)).toEqual([
    'Auto-merge on, merges when ready',
    'Review required',
  ]);
});
