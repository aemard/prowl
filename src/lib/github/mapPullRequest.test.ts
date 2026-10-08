import { describe, expect, it } from 'vitest';
import {
  checkRunNode,
  closedNode,
  detailNode,
  detailReview,
  headCommit,
  prNode,
  repositoryNode,
  requestedReviewer,
  reviewNode,
  statusContextNode,
} from '../../../tests/fixtures/github';
import type { PullRequest } from '../model';
import {
  mapClosedState,
  mapPullRequest,
  mapPullRequestDetail,
  NEUTRAL_LABEL_COLOR,
} from './mapPullRequest';

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
      viewerCanMerge: true,
      autoMergeAllowed: false,
      autoMerge: null,
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
      const commit = { committedDate: '2026-10-04T16:20:00Z', statusCheckRollup: rollup };
      expect(checks({ nodes: [{ commit }] }).state).toBe('none');
      expect(checks({ nodes: null }).state).toBe('none');
      expect(checks({ nodes: [] }).state).toBe('none');
    });
  });

  describe('author.isBot', () => {
    const author = (login: string, __typename: string) =>
      mapPullRequest(prNode({ author: { __typename, login, avatarUrl: 'a' } })).author;

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

  describe('lastCommitAt', () => {
    const lastCommitAt = (commits: ReturnType<typeof headCommit>) =>
      mapPullRequest(prNode({ commits, updatedAt: '2026-10-05T12:00:00Z' })).lastCommitAt;

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

describe('mapPullRequestDetail', () => {
  const AVATAR = 'https://avatars.githubusercontent.com/u/583231?s=64&v=4';

  it('lists failed checks first, then pending, passed and neutral, each with its link', () => {
    const detail = mapPullRequestDetail([
      detailNode({
        checks: [
          checkRunNode('lint', 'SUCCESS'),
          checkRunNode('docs', 'SKIPPED'),
          checkRunNode('build', 'FAILURE', { isRequired: true }),
          checkRunNode('e2e', 'IN_PROGRESS'),
          statusContextNode('ci/circle', 'PENDING'),
          statusContextNode('ci/jenkins', 'ERROR', { targetUrl: 'https://jenkins.example/job/1' }),
          checkRunNode('deploy', 'TIMED_OUT'),
        ],
      }),
    ]);
    expect(detail.checks.map(({ name, state }) => `${state}:${name}`)).toEqual([
      'failed:build',
      'failed:ci/jenkins',
      'failed:deploy',
      'pending:e2e',
      'pending:ci/circle',
      'passed:lint',
      'neutral:docs',
    ]);
    expect(detail.checks[0]).toEqual({
      name: 'build',
      state: 'failed',
      url: 'https://github.com/acme/widgets/actions/runs/1/job/build',
      required: true,
    });
    expect(detail.checks[1]?.required).toBe(false);
    expect(detail.checksTotal).toBe(7);
  });

  it('reads the state of a run from its conclusion once completed, else from its status', () => {
    const states = (...runs: ReturnType<typeof checkRunNode>[]) =>
      mapPullRequestDetail([detailNode({ checks: runs })]).checks.map((c) => c.state);
    expect(states(checkRunNode('a', 'CANCELLED'), checkRunNode('b', 'ACTION_REQUIRED'))).toEqual([
      'failed',
      'neutral',
    ]);
    expect(states(checkRunNode('a', 'QUEUED'), checkRunNode('b', 'WAITING'))).toEqual([
      'pending',
      'pending',
    ]);
    // COMPLETED without a conclusion, and a state GitHub adds later, are neutral.
    expect(
      states(checkRunNode('a', 'SUCCESS', { conclusion: null }), checkRunNode('b', 'BRAND_NEW')),
    ).toEqual(['neutral', 'neutral']);
  });

  it('keeps only http(s) links and skips holes and unknown contexts', () => {
    const detail = mapPullRequestDetail([
      detailNode({
        checks: [
          null,
          checkRunNode('a', 'SUCCESS', { detailsUrl: null }),
          checkRunNode('b', 'SUCCESS', { detailsUrl: 'javascript:alert(1)' }),
          statusContextNode('c', 'SUCCESS', { targetUrl: 'HTTPS://ci.example/c' }),
        ],
      }),
    ]);
    expect(detail.checks.map((c) => c.url)).toEqual([null, null, 'HTTPS://ci.example/c']);
  });

  it('merges the checks of every page and reports the total of the first', () => {
    const all = Array.from({ length: 5 }, (_, i) => checkRunNode(`job-${i}`));
    const detail = mapPullRequestDetail([
      detailNode({ checks: all, pageSize: 3 }),
      detailNode({ checks: all, pageSize: 3, after: '3' }),
    ]);
    expect(detail.checks).toHaveLength(5);
    expect(detail.checksTotal).toBe(5);
  });

  it('has no checks without a rollup, or when a read failed as a whole', () => {
    const none = { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } };
    expect(mapPullRequestDetail([detailNode(none)])).toMatchObject({ checks: [], checksTotal: 0 });
    const noNodes = detailNode();
    const [only] = noNodes.commits.nodes ?? [];
    if (only?.commit.statusCheckRollup) only.commit.statusCheckRollup.contexts.nodes = null;
    expect(mapPullRequestDetail([noNodes]).checks).toEqual([]);
    expect(mapPullRequestDetail([detailNode({ commits: { nodes: null } })]).checks).toEqual([]);
  });

  it('lists reviewers with their state, blocking ones first, and who is still asked', () => {
    const detail = mapPullRequestDetail([
      detailNode({
        latestReviews: {
          nodes: [
            detailReview('alice', 'APPROVED'),
            detailReview('bob', 'CHANGES_REQUESTED'),
            detailReview('carol', 'COMMENTED'),
            detailReview('dave', 'DISMISSED'),
            detailReview('erin', 'PENDING'),
            detailReview(null, 'APPROVED'),
            null,
          ],
        },
        reviewRequests: {
          nodes: [
            requestedReviewer('frank'),
            requestedReviewer('alice'),
            requestedReviewer(null),
            { requestedReviewer: null },
            { requestedReviewer: { login: 'hubot' } },
          ],
        },
      }),
    ]);
    expect(detail.reviewers.map(({ login, state }) => `${login}:${state}`)).toEqual([
      'bob:changes_requested',
      'frank:requested',
      'hubot:requested',
      'alice:approved',
      'ghost:approved',
      'carol:commented',
      'dave:dismissed',
    ]);
    expect(detail.reviewers[0]?.avatarUrl).toBe(AVATAR);
    expect(detail.reviewers.find((r) => r.login === 'ghost')?.avatarUrl).toBe('');
    expect(detail.reviewers.find((r) => r.login === 'hubot')?.avatarUrl).toBe('');
  });

  it('reads the base branch rules, and none when they are missing or not visible', () => {
    const rules = (branchProtectionRule: unknown) =>
      mapPullRequestDetail([detailNode({ baseRef: { branchProtectionRule } as never })]);
    expect(
      rules({ requiredApprovingReviewCount: 2, requiresConversationResolution: true }),
    ).toMatchObject({ requiredApprovals: 2, requiresConversationResolution: true });
    expect(
      rules({ requiredApprovingReviewCount: 0, requiresConversationResolution: false }),
    ).toMatchObject({ requiredApprovals: null, requiresConversationResolution: false });
    expect(rules(null)).toMatchObject({
      requiredApprovals: null,
      requiresConversationResolution: false,
    });
    expect(mapPullRequestDetail([detailNode({ baseRef: null })]).requiredApprovals).toBeNull();
  });

  it('has no reviewers when GitHub returns none', () => {
    const detail = mapPullRequestDetail([
      detailNode({ latestReviews: null, reviewRequests: null }),
    ]);
    expect(detail.reviewers).toEqual([]);
  });
});
