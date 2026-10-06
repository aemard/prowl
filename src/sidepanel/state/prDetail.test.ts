import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRunNode, detailNode } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { collapse, detailKey, details, expandedIds, loadDetail, toggleExpanded } from './prDetail';
import { auth } from './store';

const pr = buildPullRequest({ number: 7 });

beforeEach(() => {
  auth.value = buildAuth();
});

afterEach(() => {
  auth.value = undefined;
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
  it('changes with activity, check counts and merge facts, not with the poll', () => {
    const key = detailKey(pr);
    expect(detailKey({ ...pr })).toBe(key);
    expect(detailKey({ ...pr, updatedAt: '2026-10-07T00:00:00.000Z' })).not.toBe(key);
    expect(detailKey({ ...pr, checks: { ...pr.checks, failed: 1 } })).not.toBe(key);
    expect(detailKey({ ...pr, mergeStateStatus: 'clean' })).not.toBe(key);
    expect(detailKey({ ...pr, reviewDecision: 'approved' })).not.toBe(key);
    expect(detailKey({ ...pr, mergeable: 'conflicting' })).not.toBe(key);
  });
});

describe('loadDetail', () => {
  it('fetches the PR once, and not again while the entry is current', async () => {
    const fetch = stubDetailFetch(() => detailNode({ checks: [checkRunNode('lint')] }));
    const loading = loadDetail(pr);
    expect(details.value[pr.id]).toMatchObject({ loading: true, key: detailKey(pr) });
    await Promise.all([loading, loadDetail(pr)]);
    await loadDetail(pr);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body)).variables).toEqual({
      id: pr.id,
      after: null,
    });
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ Authorization: 'Bearer ghp_test' });
    expect(details.value[pr.id]).toMatchObject({ loading: false });
    expect(details.value[pr.id]?.detail?.checks.map((c) => c.name)).toEqual(['lint']);
  });

  it('does nothing when signed out', async () => {
    const fetch = stubDetailFetch();
    auth.value = undefined;
    await loadDetail(pr);
    expect(fetch).not.toHaveBeenCalled();
    expect(details.value).toEqual({});
  });

  it('refetches when the PR changed, showing the old detail meanwhile', async () => {
    let release: () => void = () => {};
    const fetch = stubDetailFetch((variables) => {
      void variables;
      return fetch.mock.calls.length === 1
        ? detailNode({ checks: [checkRunNode('old')] })
        : new Promise((resolve) => {
            release = () => resolve(detailNode({ checks: [checkRunNode('new')] }));
          });
    });
    await loadDetail(pr);
    const changed = { ...pr, updatedAt: '2026-10-07T00:00:00.000Z' };
    const reloading = loadDetail(changed);
    expect(details.value[pr.id]).toMatchObject({ loading: true });
    expect(details.value[pr.id]?.detail?.checks[0]?.name).toBe('old');
    release();
    await reloading;
    expect(details.value[pr.id]?.detail?.checks[0]?.name).toBe('new');
    expect(details.value[pr.id]?.key).toBe(detailKey(changed));
  });

  it('drops an answer that a newer request has overtaken', async () => {
    const releases: (() => void)[] = [];
    stubDetailFetch(
      () =>
        new Promise((resolve) => {
          const name = `run-${releases.length}`;
          releases.push(() => resolve(detailNode({ checks: [checkRunNode(name)] })));
        }),
    );
    const first = loadDetail(pr);
    const second = loadDetail({ ...pr, updatedAt: '2026-10-07T00:00:00.000Z' });
    releases[1]?.();
    await second;
    releases[0]?.();
    await first;
    expect(details.value[pr.id]?.detail?.checks[0]?.name).toBe('run-1');
  });

  it('keeps GitHub’s message on a failure and tries again on the next load', async () => {
    stubDetailFetch(() => jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    await loadDetail(pr);
    expect(details.value[pr.id]).toMatchObject({ loading: false, error: 'Bad credentials' });

    const fetch = stubDetailFetch();
    await loadDetail(pr);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(details.value[pr.id]?.error).toBeUndefined();
    expect(details.value[pr.id]?.detail).toBeDefined();
  });

  it('keeps the last detail when a refresh fails, and words a bug generically', async () => {
    stubDetailFetch();
    await loadDetail(pr);
    // A malformed answer is not a GitHubError: the panel says so without GitHub's words.
    stubDetailFetch(() => ({ commits: null }) as never);
    await loadDetail({ ...pr, updatedAt: '2026-10-07T00:00:00.000Z' });
    expect(details.value[pr.id]?.detail).toBeDefined();
    expect(details.value[pr.id]?.error).toBe('Could not load the details.');
  });
});
