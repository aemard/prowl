import { describe, expect, it } from 'vitest';
import { prNode, viewerNode } from '../../../tests/fixtures/github';
import { mapPullRequest } from '../../lib/github/mapPullRequest';
import type { PullRequest, Snapshot } from '../../lib/model';
import { pullRequestActivity } from './prActivity';

const baseline = '2026-11-03T12:00:00Z';
const fresh = '2026-11-03T12:01:00Z';
const pr = mapPullRequest(prNode({ createdAt: baseline }));
function snapshot(prs: PullRequest[], login = 'octocat'): Snapshot {
  return {
    fetchedAt: baseline,
    viewer: viewerNode({ login }),
    pullRequests: Object.fromEntries(prs.map((item) => [item.id, item])),
    sections: {},
  };
}

describe('pull request activity', () => {
  it('does not celebrate the first load or switching accounts', () => {
    expect(pullRequestActivity(undefined, snapshot([pr]))).toEqual([]);
    expect(pullRequestActivity(snapshot([]), snapshot([pr], 'alice'))).toEqual([]);
  });

  it('detects newly created PRs but not old PRs entering a search scope', () => {
    const created = { ...pr, createdAt: fresh };
    expect(pullRequestActivity(snapshot([]), snapshot([created]))).toEqual([
      { kind: 'new', pr: created },
    ]);
    expect(pullRequestActivity(snapshot([]), snapshot([pr]))).toEqual([]);
  });

  it.each(['merged', 'closed'] as const)(
    'detects %s once, including the viewer’s actions',
    (state) => {
      const changed = { ...pr, state, closedBy: 'octocat' };
      expect(pullRequestActivity(snapshot([pr]), snapshot([changed]))).toEqual([
        { kind: state, pr: changed },
      ]);
      expect(pullRequestActivity(snapshot([changed]), snapshot([changed]))).toEqual([]);
    },
  );

  it('does not treat a PR leaving a search or enrichment updates as a closure', () => {
    expect(pullRequestActivity(snapshot([pr]), snapshot([]))).toEqual([]);
    expect(
      pullRequestActivity(snapshot([pr]), snapshot([{ ...pr, reviewDecision: 'approved' }])),
    ).toEqual([]);
  });
});
