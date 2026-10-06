import { describe, expect, it } from 'vitest';
import { closedNode, headCommit, prNode, reviewNode } from '../../../tests/fixtures/github';
import type { PullRequest } from '../model';
import { mapClosedState, mapPullRequest, NEUTRAL_LABEL_COLOR } from './mapPullRequest';

describe('mapPullRequest', () => {
  it('maps a search node to the model', () => {
    const node = prNode({
      number: 7,
      repository: 'acme/api',
      labels: { nodes: [{ name: 'bug', color: 'D73A4A' }] },
      latestReviews: { nodes: [reviewNode('hubot', 'COMMENTED')] },
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'monalisa' } }] },
      reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] },
      totalCommentsCount: 4,
      comments: { nodes: [{ createdAt: '2026-10-05T11:00:00Z', author: { login: 'hubot' } }] },
    });
    expect(mapPullRequest(node)).toEqual({
      id: 'PR_acme_api_7',
      number: 7,
      title: 'Improve widget 7',
      url: 'https://github.com/acme/api/pull/7',
      repo: { owner: 'acme', name: 'api', nameWithOwner: 'acme/api' },
      author: {
        login: 'octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/583231?s=64&v=4',
      },
      state: 'open',
      isDraft: false,
      headRefName: 'feature-7',
      baseRefName: 'main',
      headSha: 'a'.repeat(40),
      createdAt: '2026-10-01T09:00:00Z',
      updatedAt: '2026-10-05T12:00:00Z',
      checks: { state: 'success', total: 2, passed: 2, failed: 0, pending: 0, neutral: 0 },
      reviewDecision: 'review_required',
      reviews: [
        {
          id: expect.any(String),
          author: 'hubot',
          state: 'commented',
          submittedAt: expect.any(String),
        },
      ],
      requestedReviewers: ['monalisa'],
      mergeable: 'mergeable',
      mergeStateStatus: 'blocked',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      unresolvedThreads: 1,
      commentCount: 4,
      lastComment: { author: 'hubot', createdAt: '2026-10-05T11:00:00Z' },
      closedBy: null,
      allowedMergeMethods: ['merge', 'squash'],
      viewerCanUpdate: true,
    } satisfies PullRequest);
  });

  describe('checks', () => {
    const checks = (commits: ReturnType<typeof headCommit>) =>
      mapPullRequest(prNode({ commits })).checks;

    it.each([
      ['no rollup', headCommit(null), 'none', [0, 0, 0, 0, 0]],
      ['a rollup without counts', headCommit({}), 'none', [0, 0, 0, 0, 0]],
      ['passing runs', headCommit({ SUCCESS: 3 }), 'success', [3, 3, 0, 0, 0]],
      [
        'running runs and pending statuses',
        headCommit(
          { SUCCESS: 1, QUEUED: 1, IN_PROGRESS: 1, WAITING: 1, PENDING: 1 },
          { EXPECTED: 1 },
        ),
        'pending',
        [6, 1, 0, 5, 0],
      ],
      [
        'any failure, even with checks still running',
        headCommit({ FAILURE: 1, TIMED_OUT: 1, STARTUP_FAILURE: 1, ACTION_REQUIRED: 1, QUEUED: 2 }),
        'failure',
        [6, 0, 4, 2, 0],
      ],
      [
        'failing statuses',
        headCommit({}, { ERROR: 1, FAILURE: 1, SUCCESS: 1 }),
        'failure',
        [3, 1, 2, 0, 0],
      ],
      [
        'cancelled, skipped, stale and unknown states as neutral',
        headCommit({ CANCELLED: 1, SKIPPED: 2, NEUTRAL: 1, STALE: 1, COMPLETED: 1, NEW_STATE: 1 }),
        'success',
        [7, 0, 0, 0, 7],
      ],
    ] as const)('summarizes %s', (_, commits, state, [total, passed, failed, pending, neutral]) => {
      expect(checks(commits)).toEqual({ state, total, passed, failed, pending, neutral });
    });

    it('tolerates missing counts and commits', () => {
      const rollup = {
        contexts: { checkRunCountsByState: null, statusContextCountsByState: null },
      };
      expect(checks({ nodes: [{ commit: { statusCheckRollup: rollup } }] }).state).toBe('none');
      expect(checks({ nodes: null }).state).toBe('none');
      expect(checks({ nodes: [] }).state).toBe('none');
    });
  });

  it.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes_requested'],
    ['REVIEW_REQUIRED', 'review_required'],
    [null, 'none'],
    ['SOMETHING_NEW', 'none'],
  ] as const)('maps reviewDecision %s to %s', (reviewDecision, expected) => {
    expect(mapPullRequest(prNode({ reviewDecision })).reviewDecision).toBe(expected);
  });

  it.each([
    ['MERGEABLE', 'mergeable'],
    ['CONFLICTING', 'conflicting'],
    ['UNKNOWN', 'unknown'],
    ['SOMETHING_NEW', 'unknown'],
  ])('maps mergeable %s to %s', (mergeable, expected) => {
    expect(mapPullRequest(prNode({ mergeable })).mergeable).toBe(expected);
  });

  it.each([
    ['CLEAN', 'clean'],
    ['BLOCKED', 'blocked'],
    ['BEHIND', 'behind'],
    ['DIRTY', 'dirty'],
    ['DRAFT', 'draft'],
    ['HAS_HOOKS', 'has_hooks'],
    ['UNSTABLE', 'unstable'],
    ['UNKNOWN', 'unknown'],
    ['QUEUED', 'unknown'],
  ])('maps mergeStateStatus %s to %s', (mergeStateStatus, expected) => {
    expect(mapPullRequest(prNode({ mergeStateStatus })).mergeStateStatus).toBe(expected);
  });

  it.each([
    ['OPEN', 'open'],
    ['CLOSED', 'closed'],
    ['MERGED', 'merged'],
    ['SOMETHING_NEW', 'open'],
  ])('maps state %s to %s', (state, expected) => {
    expect(mapPullRequest(prNode({ state })).state).toBe(expected);
  });

  it('keeps submitted reviews newest first and names deleted accounts ghost', () => {
    const { reviews } = mapPullRequest(
      prNode({
        latestReviews: {
          nodes: [
            reviewNode('old', 'CHANGES_REQUESTED', '2026-10-01T10:00:00Z'),
            reviewNode(null, 'DISMISSED', '2026-10-03T10:00:00Z'),
            reviewNode('new', 'APPROVED', '2026-10-04T10:00:00Z'),
            reviewNode('draft', 'PENDING', null),
            reviewNode('future', 'SOMETHING_NEW'),
            null,
          ],
        },
      }),
    );
    expect(reviews.map(({ author, state }) => [author, state])).toEqual([
      ['new', 'approved'],
      ['ghost', 'dismissed'],
      ['old', 'changes_requested'],
    ]);
  });

  it('lists requested users and bots, without teams (not selected) or holes', () => {
    const pr = mapPullRequest(
      prNode({
        reviewRequests: {
          nodes: [
            { requestedReviewer: { login: 'monalisa' } },
            { requestedReviewer: {} },
            { requestedReviewer: null },
            null,
            { requestedReviewer: { login: 'copilot-pull-request-reviewer' } },
          ],
        },
      }),
    );
    expect(pr.requestedReviewers).toEqual(['monalisa', 'copilot-pull-request-reviewer']);
    expect(mapPullRequest(prNode({ reviewRequests: null })).requestedReviewers).toEqual([]);
  });

  it('validates label colors and falls back to a neutral one', () => {
    const colors = ['FFAA00', 'red', '#ffaa00', '', 'ffaa001'];
    const { labels } = mapPullRequest(
      prNode({ labels: { nodes: [...colors.map((color) => ({ name: color, color })), null] } }),
    );
    expect(labels.map(({ color }) => color)).toEqual([
      'ffaa00',
      NEUTRAL_LABEL_COLOR,
      NEUTRAL_LABEL_COLOR,
      NEUTRAL_LABEL_COLOR,
      NEUTRAL_LABEL_COLOR,
    ]);
    expect(NEUTRAL_LABEL_COLOR).toMatch(/^[0-9a-f]{6}$/);
    expect(mapPullRequest(prNode({ labels: null })).labels).toEqual([]);
  });

  it('handles deleted authors, missing counts and empty connections', () => {
    const pr = mapPullRequest(
      prNode({
        author: null,
        totalCommentsCount: null,
        latestReviews: null,
        comments: { nodes: [{ createdAt: '2026-10-05T11:00:00Z', author: null }] },
        reviewThreads: { nodes: null },
      }),
    );
    expect(pr).toMatchObject({
      author: null,
      commentCount: 0,
      reviews: [],
      lastComment: { author: 'ghost', createdAt: '2026-10-05T11:00:00Z' },
      unresolvedThreads: 0,
    });
    expect(mapPullRequest(prNode({ comments: { nodes: null } })).lastComment).toBeNull();
  });

  it('lists the merge methods the repository allows', () => {
    const methods = (mergeCommitAllowed: boolean, squashMergeAllowed: boolean, rebase: boolean) => {
      const node = prNode();
      node.repository = {
        ...node.repository,
        mergeCommitAllowed,
        squashMergeAllowed,
        rebaseMergeAllowed: rebase,
      };
      return mapPullRequest(node).allowedMergeMethods;
    };
    expect(methods(true, true, true)).toEqual(['merge', 'squash', 'rebase']);
    expect(methods(false, true, false)).toEqual(['squash']);
    expect(methods(false, false, false)).toEqual([]);
  });

  it('takes closedBy from mergedBy', () => {
    const pr = mapPullRequest(prNode({ state: 'MERGED', mergedBy: { login: 'hubot' } }));
    expect(pr).toMatchObject({ state: 'merged', closedBy: 'hubot' });
  });
});

describe('mapClosedState', () => {
  const open = mapPullRequest(prNode());

  it('marks a merged PR with whoever merged it', () => {
    expect(mapClosedState(open, closedNode(open.id, { by: 'hubot' }))).toEqual({
      ...open,
      state: 'merged',
      updatedAt: '2026-10-06T08:00:00Z',
      closedBy: 'hubot',
    });
  });

  it('marks a closed PR with the actor of the latest ClosedEvent', () => {
    const closed = mapClosedState(open, closedNode(open.id, { state: 'CLOSED', by: 'monalisa' }));
    expect(closed).toMatchObject({ state: 'closed', closedBy: 'monalisa' });
    const node = closedNode(open.id, { state: 'CLOSED', by: null });
    expect(mapClosedState(open, node)?.closedBy).toBeNull();
    expect(mapClosedState(open, { ...node, timelineItems: { nodes: null } })?.closedBy).toBeNull();
  });

  it('trusts merged over an unknown state', () => {
    const node = { ...closedNode(open.id), state: 'SOMETHING_NEW' };
    expect(mapClosedState(open, node)?.state).toBe('merged');
  });

  it('returns null while the PR is still open', () => {
    expect(mapClosedState(open, closedNode(open.id, { state: 'OPEN' }))).toBeNull();
    expect(
      mapClosedState(open, { ...closedNode(open.id), merged: false, state: 'NEW' }),
    ).toBeNull();
  });
});
