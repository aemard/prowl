/** Builders for the stored values the side panel reads. Used by the panel's unit tests. */
import type { AuthState, PollState, PullRequest, PullRequestDetail, Snapshot } from '../lib/model';

export function buildAuth(login = 'octocat'): AuthState {
  return {
    method: 'pat',
    token: 'ghp_test',
    tokenType: 'classic',
    scopes: ['repo'],
    viewer: { login, avatarUrl: `https://avatars.githubusercontent.com/${login}`, name: null },
    createdAt: '2026-10-06T08:00:00.000Z',
  };
}

export function buildSnapshot(fetchedAt = '2026-10-06T11:58:00.000Z'): Snapshot {
  return { fetchedAt, viewer: buildAuth().viewer, pullRequests: {}, sections: {} };
}

export function buildPollState(overrides: Partial<PollState> = {}): PollState {
  return {
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextAllowedAt: null,
    consecutiveFailures: 0,
    rateLimit: null,
    lastError: null,
    inFlight: false,
    ...overrides,
  };
}

/** When the tests started: a default `lastCommitAt` that the 20-day rule never hides. */
const RECENT_COMMIT = new Date().toISOString();

/** An open, mergeable PR with no checks, reviews or labels; override what a test cares about. */
export function buildPullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  const number = overrides.number ?? 1;
  const nameWithOwner = overrides.repo?.nameWithOwner ?? 'acme/widgets';
  const [owner = '', name = ''] = nameWithOwner.split('/');
  return {
    id: `PR_${nameWithOwner.replace('/', '_')}_${number}`,
    number,
    title: `Improve widget ${number}`,
    url: `https://github.com/${nameWithOwner}/pull/${number}`,
    repo: { owner, name, nameWithOwner },
    author: {
      login: 'alice',
      avatarUrl: 'https://avatars.githubusercontent.com/alice',
      isBot: false,
    },
    state: 'open',
    isDraft: false,
    headRefName: `feature-${number}`,
    baseRefName: 'main',
    headSha: 'a'.repeat(40),
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    lastCommitAt: RECENT_COMMIT,
    checks: { state: 'none', total: 0, passed: 0, failed: 0, pending: 0, neutral: 0 },
    reviewDecision: 'none',
    reviews: [],
    requestedReviewers: [],
    mergeable: 'mergeable',
    mergeStateStatus: 'blocked',
    labels: [],
    unresolvedThreads: 0,
    commentCount: 0,
    lastComment: null,
    closedBy: null,
    allowedMergeMethods: ['merge', 'squash'],
    defaultMergeMethod: 'merge',
    viewerCanUpdate: true,
    viewerCanMerge: true,
    autoMergeAllowed: false,
    autoMerge: null,
    ...overrides,
  };
}

/** A snapshot whose sections hold these PRs (section id -> PRs, in order). */
export function buildSnapshotOf(
  sections: Record<string, PullRequest[]>,
  overrides: Partial<Snapshot> = {},
): Snapshot {
  const snapshot = buildSnapshot();
  for (const [id, prs] of Object.entries(sections)) {
    snapshot.sections[id] = prs.map((pr) => pr.id);
    for (const pr of prs) snapshot.pullRequests[pr.id] = pr;
  }
  return { ...snapshot, ...overrides };
}

/** A detail with no checks or reviewers and a base branch that asks for one approval. */
export function buildDetail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    checks: [],
    checksTotal: 0,
    reviewers: [],
    requiredApprovals: 1,
    requiresConversationResolution: false,
    ...overrides,
  };
}
