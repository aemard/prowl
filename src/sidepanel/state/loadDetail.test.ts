import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRunNode, detailNode } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildDetail, buildPullRequest } from '../../test/panel';
import { loadDetail, mergeDetailOf, mergeKey } from './loadDetail';
import { detailKey, detailOf, details } from './prDetail';
import { auth, snapshot } from './store';

const pr = buildPullRequest({ number: 7 });

beforeEach(() => {
  auth.value = buildAuth();
});

afterEach(() => {
  auth.value = undefined;
  snapshot.value = undefined;
});

describe('loadDetail', () => {
  it('fetches the PR once, and not again while the entry is current', async () => {
    const fetch = stubDetailFetch(() => detailNode({ checks: [checkRunNode('lint')] }));
    const loading = loadDetail(pr);
    expect(details.value[pr.id]).toMatchObject({ loading: true, key: detailKey(pr) });
    await Promise.all([loading, loadDetail(pr)]);
    await loadDetail(pr);

    expect(fetch).toHaveBeenCalledTimes(2);
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
    expect(details.value[pr.id]?.mergeKey).toBe(mergeKey(changed));
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

  it.each([
    ['B then A', false, 'ghp_other'],
    ['A then B', true, 'ghp_other'],
    ['B then A', false, 'ghp_test'],
    ['A then B', true, 'ghp_test'],
  ])(
    'drops old auth responses in order %s (old first: %s) after signing in with token %s',
    async (_, oldFirst, token) => {
      const releases: (() => void)[] = [];
      stubDetailFetch(
        () =>
          new Promise((resolve) => {
            const name = releases.length === 0 ? 'account-A' : 'account-B';
            releases.push(() => resolve(detailNode({ checks: [checkRunNode(name)] })));
          }),
      );
      const first = loadDetail(pr);
      auth.value = undefined;
      auth.value = { ...buildAuth(), token };
      const second = loadDetail(pr);
      const pending = details.value[pr.id];

      if (oldFirst) {
        releases[0]?.();
        await first;
        expect(details.value[pr.id]).toBe(pending);
        expect(details.value[pr.id]).toMatchObject({ loading: true });
        expect(details.value[pr.id]?.detail).toBeUndefined();
      }
      releases[1]?.();
      await second;
      const completed = details.value[pr.id];
      expect(completed).toMatchObject({ loading: false });
      expect(completed?.detail?.checks[0]?.name).toBe('account-B');
      if (!oldFirst) {
        releases[0]?.();
        await first;
        expect(details.value[pr.id]).toBe(completed);
      }
    },
  );

  it('keeps GitHub’s message on a failure and tries again on the next load', async () => {
    stubDetailFetch(() => jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    await loadDetail(pr);
    expect(details.value[pr.id]).toMatchObject({ loading: false, error: 'Bad credentials' });

    const fetch = stubDetailFetch();
    await loadDetail(pr);
    expect(fetch).toHaveBeenCalledTimes(2);
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

describe('mergeDetailOf', () => {
  const read = buildDetail({ mergeQueue: null });
  const commented = { ...pr, updatedAt: '2030-01-01T00:00:00Z' };
  afterEach(() => {
    details.value = {};
  });

  it('keeps the previous detail while a reload for a comment is pending or failed', () => {
    for (const reload of [{ loading: true }, { loading: false, error: 'Offline' }]) {
      details.value = {
        [pr.id]: { key: detailKey(commented), mergeKey: mergeKey(pr), detail: read, ...reload },
      };
      expect(detailOf(commented).detail).toBeUndefined();
      expect(mergeDetailOf(commented)).toEqual({ detail: read, failed: false });
    }
  });

  it('drops it once the head, the base or the methods changed', () => {
    details.value = {
      [pr.id]: { key: detailKey(pr), mergeKey: mergeKey(pr), detail: read, loading: true },
    };
    for (const changed of [
      { headSha: 'c'.repeat(40) },
      { baseRefName: 'next' },
      { allowedMergeMethods: [] },
    ])
      expect(mergeDetailOf({ ...pr, ...changed }).detail).toBeUndefined();
  });
});
