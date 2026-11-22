import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { loadDetail } from './loadDetail';
import { collapse, detailKey, details, expandedIds, toggleExpanded } from './prDetail';
import { auth, snapshot } from './store';

const pr = buildPullRequest({ number: 7 });

beforeEach(() => {
  auth.value = buildAuth();
});

afterEach(() => {
  auth.value = undefined;
  snapshot.value = undefined;
});

describe('expanded cards', () => {
  it('toggles and collapses by id, keeping the others', () => {
    toggleExpanded('a');
    toggleExpanded('b');
    expect(expandedIds.value).toEqual(['a', 'b']);
    toggleExpanded('a');
    expect(expandedIds.value).toEqual(['b']);
    collapse('b');
    collapse('never-open');
    expect(expandedIds.value).toEqual([]);
  });

  it('are forgotten, with their details, when another account signs in or out', async () => {
    stubDetailFetch();
    toggleExpanded(pr.id);
    await loadDetail(pr);
    expect(details.value[pr.id]?.detail).toBeDefined();

    auth.value = { ...buildAuth(), token: 'ghp_other' };
    expect(expandedIds.value).toEqual([]);
    expect(details.value).toEqual({});

    toggleExpanded(pr.id);
    auth.value = { ...auth.value, scopes: ['repo', 'read:org'] };
    expect(expandedIds.value).toEqual([pr.id]);

    auth.value = undefined;
    expect(expandedIds.value).toEqual([]);
  });
});

describe('detailKey', () => {
  it('changes with the head, activity, check counts and reviewers, not merge enrichment', () => {
    const key = detailKey(pr);
    expect(detailKey({ ...pr })).toBe(key);
    expect(detailKey({ ...pr, headSha: 'b'.repeat(40) })).not.toBe(key);
    expect(
      detailKey({
        ...pr,
        checks: { ...Object.fromEntries(Object.entries(pr.checks).reverse()) } as typeof pr.checks,
      }),
    ).toBe(key);
    expect(detailKey({ ...pr, updatedAt: '2026-10-07T00:00:00.000Z' })).not.toBe(key);
    expect(detailKey({ ...pr, checks: { ...pr.checks, failed: 1 } })).not.toBe(key);
    expect(detailKey({ ...pr, requestedReviewers: ['alice'] })).not.toBe(key);
    expect(detailKey({ ...pr, mergeStateStatus: 'clean' })).toBe(key);
    expect(detailKey({ ...pr, reviewDecision: 'approved' })).toBe(key);
    expect(detailKey({ ...pr, mergeable: 'conflicting' })).toBe(key);
  });
});
