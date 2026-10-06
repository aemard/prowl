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
    'a draft says so and nothing about reviews',
    { isDraft: true, reviewDecision: 'review_required', mergeStateStatus: 'draft' },
    buildDetail(),
    ['Blocked: draft, mark it ready for review to merge'],
  ],
  [
    'conflicts name the base branch',
    { mergeable: 'conflicting', mergeStateStatus: 'dirty', baseRefName: 'develop' },
    undefined,
    ['Conflicts with develop'],
  ],
  [
    'behind the base branch',
    { mergeStateStatus: 'behind' },
    undefined,
    ['Blocked: branch is behind main'],
  ],
  [
    'one approval required',
    { reviewDecision: 'review_required' },
    buildDetail({ requiredApprovals: 1 }),
    ['Blocked: 1 approval required'],
  ],
  [
    'two approvals required',
    { reviewDecision: 'review_required' },
    buildDetail({ requiredApprovals: 2 }),
    ['Blocked: 2 approvals required'],
  ],
  [
    'one more approval after one',
    { reviewDecision: 'review_required', reviews: [review('bob', 'approved')] },
    buildDetail({ requiredApprovals: 2 }),
    ['Blocked: 1 more approval required'],
  ],
  [
    'a rule that is not visible: just review required',
    { reviewDecision: 'review_required' },
    buildDetail({ requiredApprovals: null }),
    ['Blocked: review required'],
  ],
  [
    'review required before the detail loads',
    { reviewDecision: 'review_required' },
    undefined,
    ['Blocked: review required'],
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
    ['Blocked: changes requested by alice, carol'],
  ],
  [
    'changes requested by someone unknown',
    { reviewDecision: 'changes_requested' },
    undefined,
    ['Blocked: changes requested'],
  ],
  [
    'required failing checks, counted from the detail',
    { checks: counts(3), mergeStateStatus: 'blocked' },
    buildDetail({
      checks: [check('a', 'failed', true), check('b', 'failed'), check('c', 'failed', true)],
    }),
    ['Blocked: 2 required checks failing'],
  ],
  [
    'failing checks that are not required do not block',
    { checks: counts(1), mergeStateStatus: 'unstable' },
    buildDetail({ checks: [check('a', 'failed')] }),
    ['1 check failing, but not required', 'Ready to merge'],
  ],
  [
    'failing checks before the detail loads block unless GitHub says unstable',
    { checks: counts(2), mergeStateStatus: 'blocked' },
    undefined,
    ['Blocked: 2 checks failing'],
  ],
  [
    'unstable without a detail: not required',
    { checks: counts(2), mergeStateStatus: 'unstable' },
    undefined,
    ['2 checks failing, but not required', 'Ready to merge'],
  ],
  [
    'a detail with no checks (unreadable) falls back to the counts',
    { checks: counts(1), mergeStateStatus: 'blocked' },
    buildDetail({ checks: [] }),
    ['Blocked: 1 check failing'],
  ],
  [
    'waiting for required checks',
    { checks: counts(0, 2), mergeStateStatus: 'blocked' },
    buildDetail({
      checks: [check('a', 'pending', true), check('b', 'pending'), check('c', 'pending', true)],
    }),
    ['Waiting for 2 required checks to finish'],
  ],
  [
    'pending checks while blocked, before the detail loads',
    { checks: counts(0, 1), mergeStateStatus: 'blocked' },
    undefined,
    ['Waiting for 1 check to finish'],
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
    ['Blocked: 2 conversations to resolve'],
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
    ['Blocked: 1 approval required', 'Conflicts with main', 'Blocked: 1 required check failing'],
  ],
  [
    'blocked for a reason GitHub does not tell',
    { mergeStateStatus: 'blocked' },
    buildDetail(),
    ["Blocked by the base branch's rules"],
  ],
  [
    'mergeability still being computed',
    { mergeable: 'unknown', mergeStateStatus: 'unknown' },
    undefined,
    ['GitHub is still checking whether it can be merged'],
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
