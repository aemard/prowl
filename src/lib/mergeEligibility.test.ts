import { describe, expect, it } from 'vitest';
import { pr, ready } from './diff/diffSnapshots.test-support';
import { isReadyToMerge } from './mergeEligibility';

describe('isReadyToMerge', () => {
  it.each(['blocked', 'behind', 'dirty', 'draft', 'unknown'] as const)(
    'never overrides GitHub %s with passing local facts',
    (mergeStateStatus) => {
      expect(isReadyToMerge(pr({ ...ready(), mergeStateStatus }))).toBe(false);
    },
  );
  it.each(['clean', 'unstable', 'has_hooks'] as const)('accepts GitHub %s', (mergeStateStatus) => {
    expect(isReadyToMerge(pr(ready({ mergeStateStatus })))).toBe(true);
    expect(isReadyToMerge(pr(ready({ mergeStateStatus, reviewDecision: 'none' })))).toBe(true);
  });
  it.each([
    { reviewDecision: 'unknown' },
    { reviewDecision: 'review_required' },
    { reviewDecision: 'changes_requested' },
    { mergeable: 'conflicting' },
    { mergeable: 'unknown' },
    { isDraft: true },
  ] as const)('is false for %j even when GitHub says clean', (overrides) => {
    expect(isReadyToMerge(pr(ready(overrides)))).toBe(false);
  });

  it('is false once the PR is merged or closed', () => {
    expect(isReadyToMerge(pr(ready()))).toBe(true);
    expect(isReadyToMerge(pr(ready({ state: 'merged' })))).toBe(false);
    expect(isReadyToMerge(pr(ready({ state: 'closed' })))).toBe(false);
  });
});
