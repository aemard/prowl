import { describe, expect, it } from 'vitest';
import { buildPullRequest, buildSnapshotOf } from '../test/panel';
import { stackedOn } from './stack';

describe('stackedOn', () => {
  const base = buildPullRequest({ number: 1, headRefName: 'feature-a', baseRefName: 'main' });
  const top = buildPullRequest({ number: 2, headRefName: 'feature-b', baseRefName: 'feature-a' });
  const elsewhere = buildPullRequest({
    number: 3,
    baseRefName: 'feature-a',
    repo: { owner: 'acme', name: 'api', nameWithOwner: 'acme/api' },
  });
  const snapshot = buildSnapshotOf({ authored: [base, top, elsewhere] });

  it('finds the open pull request whose head branch is the base, in the same repository', () => {
    expect(stackedOn(snapshot, top)?.number).toBe(1);
    expect(stackedOn(snapshot, base)).toBeUndefined();
    expect(stackedOn(snapshot, elsewhere)).toBeUndefined();
  });

  it('ignores closed pull requests on either side', () => {
    expect(stackedOn(snapshot, { ...top, state: 'merged' })).toBeUndefined();
    const merged = buildSnapshotOf({ authored: [{ ...base, state: 'merged' }, top] });
    expect(stackedOn(merged, top)).toBeUndefined();
  });
});
