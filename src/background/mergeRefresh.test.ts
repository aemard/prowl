import { beforeEach, expect, it, vi } from 'vitest';
import { mergeStateResponse, prNode } from '../../tests/fixtures/github';
import { graphqlError, graphqlRateLimit, jsonResponse } from '../../tests/fixtures/http';
import { mapPullRequest } from '../lib/github/mapPullRequest';
import { defaultSettings } from '../lib/storage/settings';
import { getItem, removeItems, setItem, setItems } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildAuth, buildPollState, buildSnapshotOf } from '../test/panel';
import { refreshMergeState, setMergePriority } from './poller';

const node = prNode({ mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED' });
const pr = { ...mapPullRequest(node), mergeStateStatus: 'blocked' as const };

beforeEach(async () => {
  await setItems({
    auth: buildAuth(),
    snapshot: buildSnapshotOf({ authored: [pr] }),
    pollState: buildPollState(),
  });
});

const serve = (reply = () => jsonResponse({ data: mergeStateResponse([pr.id], [node]) })) => {
  const fetch = vi.fn(async () => reply());
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

it('marks only the targeted card as pending and clears it if its head changes during the read', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      expect(await getItem('pollState')).toMatchObject({ inFlight: false, mergePending: [pr.id] });
      await setItem(
        'snapshot',
        buildSnapshotOf({ authored: [{ ...pr, headSha: 'b'.repeat(40) }] }),
      );
      return jsonResponse({ data: mergeStateResponse([pr.id], [node]) });
    }),
  );
  await refreshMergeState(pr.id, pr.headSha);
  expect(await getItem('pollState')).not.toHaveProperty('mergePending');
  expect((await getItem('snapshot'))?.pullRequests[pr.id]?.headSha).toBe('b'.repeat(40));
});

it('reads one PR without searches, shares a recent read and preserves list freshness', async () => {
  const fetch = serve();
  const before = await getItem('snapshot');
  await Promise.all([refreshMergeState(pr.id, pr.headSha), refreshMergeState(pr.id, pr.headSha)]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const after = await getItem('snapshot');
  expect(after?.pullRequests[pr.id]?.mergeStateStatus).toBe('clean');
  expect(after?.fetchedAt).toBe(before?.fetchedAt);
  expect(after?.sections).toEqual(before?.sections);
  expect(after?.mergeStateAt?.[pr.id]).toBeDefined();
  expect((await getItem('pollState'))?.rateLimit?.remaining).toBe(4990);
});

it('updates the badge and reports a readiness change only once', async () => {
  serve();
  await setItem('settings', {
    ...defaultSettings(),
    notifications: { ...defaultSettings().notifications, enabled: true },
  });
  // Neither fallback readiness nor a clean state before the refresh.
  await setItem('snapshot', buildSnapshotOf({ authored: [{ ...pr, mergeable: 'unknown' }] }));
  await refreshMergeState(pr.id, pr.headSha);
  await refreshMergeState(pr.id, pr.headSha);
  expect(fakeChrome().__state.notifications.size).toBe(1);
  expect([...fakeChrome().__state.notifications.keys()][0]).toContain(':ready_to_merge:');
});

it('rejects facts returned for a newer head than the card being refreshed', async () => {
  serve(() =>
    jsonResponse({ data: mergeStateResponse([pr.id], [{ ...node, headRefOid: 'b'.repeat(40) }]) }),
  );
  await refreshMergeState(pr.id, pr.headSha);
  expect((await getItem('snapshot'))?.pullRequests[pr.id]?.mergeStateStatus).toBe('blocked');
  expect((await getItem('snapshot'))?.mergeStateAt?.[pr.id]).toBeUndefined();
});

it('honors rate-limit waits and rejects stale heads and absent PRs without fetching', async () => {
  const fetch = serve();
  await refreshMergeState('missing', pr.headSha);
  await refreshMergeState(pr.id, 'b'.repeat(40));
  await setItem(
    'pollState',
    buildPollState({ nextAllowedAt: new Date(Date.now() + 60_000).toISOString() }),
  );
  await refreshMergeState(pr.id, pr.headSha);
  expect(fetch).not.toHaveBeenCalled();
});

it('records a low budget from a targeted read and stops subsequent reads', async () => {
  const fetch = serve(() =>
    jsonResponse({
      data: {
        ...mergeStateResponse([pr.id], [node]),
        rateLimit: graphqlRateLimit({
          remaining: 1,
          resetAt: new Date(Date.now() + 600_000).toISOString(),
        }),
      },
    }),
  );
  await refreshMergeState(pr.id, pr.headSha);
  expect((await getItem('pollState'))?.nextAllowedAt).not.toBeNull();
  await refreshMergeState(pr.id, pr.headSha);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not restore the snapshot or poll state after sign-out during a read', async () => {
  serve(() => {
    void removeItems('auth', 'snapshot', 'pollState');
    return jsonResponse({ data: mergeStateResponse([pr.id], [node]) });
  });
  await refreshMergeState(pr.id, pr.headSha);
  expect(await getItem('snapshot')).toBeUndefined();
  expect(await getItem('pollState')).toBeUndefined();
});

it('backs off after an error and retains the cached merge facts', async () => {
  const fetch = serve(() => jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
  await refreshMergeState(pr.id, pr.headSha);
  expect((await getItem('snapshot'))?.pullRequests[pr.id]?.mergeStateStatus).toBe('blocked');
  expect(await getItem('pollState')).toMatchObject({ lastError: { kind: 'unauthorized' } });
  await refreshMergeState(pr.id, pr.headSha);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await getItem('pollState')).not.toHaveProperty('mergePending');
});

it('visibility hints alone never trigger a GitHub read', () => {
  const fetch = serve();
  setMergePriority('panel-1', [pr.id]);
  setMergePriority('panel-1', []);
  expect(fetch).not.toHaveBeenCalled();
});

it('does not publish readiness from a partially forbidden targeted response', async () => {
  serve(() =>
    jsonResponse({
      data: mergeStateResponse([pr.id], [node]),
      errors: [
        graphqlError('FORBIDDEN', 'Review requirements unavailable', [
          'nodes',
          0,
          'reviewDecision',
        ]),
      ],
    }),
  );
  await refreshMergeState(pr.id, pr.headSha);
  expect((await getItem('snapshot'))?.pullRequests[pr.id]?.mergeStateStatus).toBe('blocked');
  expect((await getItem('snapshot'))?.mergeStateAt?.[pr.id]).toBeUndefined();
  expect((await getItem('pollState'))?.lastError?.kind).toBe('forbidden');
});
