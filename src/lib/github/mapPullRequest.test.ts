import { describe, expect, it } from 'vitest';
import { headCommit, prNode, repositoryNode, reviewNode } from '../../../tests/fixtures/github';
import type { PullRequest } from '../model';
import { mapPullRequest, NEUTRAL_LABEL_COLOR } from './mapPullRequest';

describe('mapPullRequest', () => {
  it('maps auto-merge: whether the repository allows it, and the method and who turned it on', () => {
    const on = mapPullRequest(
      prNode({
        repository: 'acme/widgets',
        autoMergeRequest: { mergeMethod: 'SQUASH', enabledBy: { login: 'alice' } },
      }),
    );
    expect(on.autoMerge).toEqual({ method: 'squash', enabledBy: 'alice' });
    const ghost = mapPullRequest(
      prNode({ autoMergeRequest: { mergeMethod: 'BOGUS', enabledBy: null } }),
    );
    expect(ghost.autoMerge).toEqual({ method: 'merge', enabledBy: null });
    expect(mapPullRequest(prNode()).autoMerge).toBeNull();
    expect(mapPullRequest(prNode()).autoMergeAllowed).toBe(false);
    const allowed = {
      ...prNode(),
      repository: repositoryNode('acme/widgets', { autoMergeAllowed: true }),
    };
    expect(mapPullRequest(allowed).autoMergeAllowed).toBe(true);
  });

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
      commits: headCommit({ SUCCESS: 2 }, {}, '2026-10-04T16:20:00Z'),
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
        isBot: false,
      },
      state: 'open',
      isDraft: false,
      headRefName: 'feature-7',
      baseRefName: 'main',
      headSha: 'a'.repeat(40),
      createdAt: '2026-10-01T09:00:00Z',
      updatedAt: '2026-10-05T12:00:00Z',
      lastCommitAt: '2026-10-04T16:20:00Z',
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
      defaultMergeMethod: 'merge',
      viewerCanUpdate: true,
      viewerCanMergeAsAdmin: false,
      viewerCanEnableAutoMerge: true,
      viewerCanDisableAutoMerge: true,
      viewerCanMerge: true,
      autoMergeAllowed: false,
      autoMerge: null,
    } satisfies PullRequest);
  });

  const author = (login: string, __typename: string) =>
    mapPullRequest(prNode({ author: { __typename, login, avatarUrl: 'a' } })).author;

  describe('author.isBot', () => {
    it.each([
      // GraphQL: the type says it, the login has no suffix.
      ['Bot', 'dependabot', true],
      // The suffix says it on its own, as REST spells bot logins.
      ['User', 'renovate[bot]', true],
      ['Bot', 'renovate[bot]', true],
      ['User', 'octocat', false],
      // A person who happens to be called like a bot is not one.
      ['User', 'bot', false],
      ['Mannequin', 'dependabot-fan', false],
      ['Organization', 'acme', false],
    ])('is %s %s -> %s', (typename, login, isBot) => {
      expect(author(login, typename)).toEqual({ login, avatarUrl: 'a', isBot });
    });

    it('is absent with the author of a deleted account', () => {
      expect(mapPullRequest(prNode({ author: null })).author).toBeNull();
    });
  });

  const lastCommitAt = (commits: ReturnType<typeof headCommit>) =>
    mapPullRequest(prNode({ commits, updatedAt: '2026-10-05T12:00:00Z' })).lastCommitAt;

  describe('lastCommitAt', () => {
    it("is the head commit's committedDate, however recent the other activity", () => {
      expect(lastCommitAt(headCommit(null, {}, '2026-08-30T07:15:00Z'))).toBe(
        '2026-08-30T07:15:00Z',
      );
    });

    it('falls back to the last activity when the head commit did not load', () => {
      expect(lastCommitAt({ nodes: [null] })).toBe('2026-10-05T12:00:00Z');
      expect(lastCommitAt({ nodes: [] })).toBe('2026-10-05T12:00:00Z');
      expect(lastCommitAt({ nodes: null })).toBe('2026-10-05T12:00:00Z');
    });
  });

  it.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes_requested'],
    ['REVIEW_REQUIRED', 'review_required'],
    [null, 'none'],
    ['SOMETHING_NEW', 'unknown'],
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

  it('starts the merge dialog on the viewer’s default method, merge when GitHub says something new', () => {
    const start = (viewerDefaultMergeMethod: string) => {
      const node = prNode();
      node.repository = { ...node.repository, viewerDefaultMergeMethod };
      return mapPullRequest(node).defaultMergeMethod;
    };
    expect(start('SQUASH')).toBe('squash');
    expect(start('REBASE')).toBe('rebase');
    expect(start('FAST_FORWARD')).toBe('merge');
  });

  it('lets the viewer merge with write access or more, not with less or as a GitHub App', () => {
    const can = (viewerPermission: string | null) => {
      const node = prNode();
      node.repository = { ...node.repository, viewerPermission };
      return mapPullRequest(node).viewerCanMerge;
    };
    expect(['WRITE', 'MAINTAIN', 'ADMIN'].map(can)).toEqual([true, true, true]);
    expect(['TRIAGE', 'READ', 'FUTURE_LEVEL', null].map(can)).toEqual([false, false, false, false]);
  });

  it('takes closedBy from mergedBy', () => {
    const pr = mapPullRequest(prNode({ state: 'MERGED', mergedBy: { login: 'hubot' } }));
    expect(pr).toMatchObject({ state: 'merged', closedBy: 'hubot' });
  });
});

it('reports nested connection limits instead of treating a bounded slice as complete', () => {
  const pr = mapPullRequest(
    prNode({
      latestReviews: { nodes: [], totalCount: 21, pageInfo: { hasNextPage: true } },
      reviewRequests: { nodes: [], totalCount: 22 },
      reviewThreads: { nodes: [], totalCount: 101 },
    }),
  );
  expect(pr.incomplete).toEqual(['reviews', 'review requests', 'conversations']);
});
