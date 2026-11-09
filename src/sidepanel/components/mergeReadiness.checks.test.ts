import { expect, it } from 'vitest';
import type { PullRequest } from '../../lib/model';
import { buildDetail, buildPullRequest } from '../../test/panel';
import { mergeReadiness } from './mergeReadiness';

const failing = buildPullRequest({
  mergeStateStatus: 'clean',
  checks: { state: 'failure', total: 1, failed: 1, passed: 0, pending: 0, neutral: 0 },
});

it.each(['clean', 'has_hooks', 'blocked'] as const)(
  'keeps an unknown check requirement a danger blocker when %s',
  (mergeStateStatus) => {
    const pr = { ...failing, mergeStateStatus };
    const detail = buildDetail({
      checks: [{ name: 'build', state: 'failed', required: null, url: null }],
      checksTotal: 1,
    });
    for (const evidence of [undefined, buildDetail(), detail]) {
      expect(mergeReadiness(pr, evidence)).toEqual([{ tone: 'danger', text: '1 check failed' }]);
    }
  },
);

it.each([false, null] as const)('mutes a failure only with optional evidence (%s)', (required) => {
  const detail = buildDetail({
    checks: [{ name: 'build', state: 'failed', required, url: null }],
    checksTotal: 1,
  });
  const pr = {
    ...failing,
    mergeStateStatus: required === false ? 'clean' : 'unstable',
  } as PullRequest;
  expect(mergeReadiness(pr, detail)).toEqual([
    { tone: 'success', text: 'Ready to merge' },
    { tone: 'neutral', text: '1 optional check failed' },
  ]);
});

it.each(['mergeable', 'mergeStateStatus', 'reviewDecision'] as const)(
  'never claims ready with unknown %s, even with optional checks',
  (field) => {
    const pr = { ...failing, mergeStateStatus: 'unstable', [field]: 'unknown' } as PullRequest;
    const lines = mergeReadiness(pr);
    expect(lines.some(({ text }) => text === 'Ready to merge')).toBe(false);
    expect(lines).toContainEqual({ tone: 'attention', text: 'Checking merge status…' });
  },
);

it.each(['dirty', 'blocked', 'draft'] as const)(
  'gives an unexplained %s verdict a fallback',
  (mergeStateStatus) => {
    expect(mergeReadiness(buildPullRequest({ mergeStateStatus }))).toEqual([
      { tone: 'attention', text: 'Blocked by branch rules', link: 'Details on GitHub' },
    ]);
  },
);

it('does not require conversations when branch requirements have not loaded', () => {
  expect(
    mergeReadiness(buildPullRequest({ mergeStateStatus: 'clean', unresolvedThreads: 2 })),
  ).toEqual([{ tone: 'success', text: 'Ready to merge' }]);
});
