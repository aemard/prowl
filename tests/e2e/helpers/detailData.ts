/**
 * What `ProwlPullRequestDetail` answers for the pull requests of `listData.ts`: the failing,
 * conflicting and ready-to-merge ones have checks, reviewers and branch rules to show; any other
 * PR gets an empty, unprotected detail. Register it with `mockDetail(github)`.
 */
import {
  checkRunNode,
  detailNode,
  detailResponse,
  prId,
  statusContextNode,
} from '../../fixtures/github';
import { MOCK_ORIGIN, type MockGitHub } from '../mock-github/server';
import { by } from './listData';

/** A check run whose page is on the mock GitHub site, the only origin the panel opens. */
const run = (name: string, state?: string, extra: Parameters<typeof checkRunNode>[2] = {}) =>
  checkRunNode(name, state, {
    detailsUrl: `${MOCK_ORIGIN}/acme/web/actions/runs/1/job/${encodeURIComponent(name)}`,
    ...extra,
  });

const review = (login: Parameters<typeof by>[0], state: string) => ({ state, author: by(login) });
const asked = (login: Parameters<typeof by>[0]) => ({ requestedReviewer: by(login) });
const rule = (requiredApprovingReviewCount: number, requiresConversationResolution = false) => ({
  branchProtectionRule: { requiredApprovingReviewCount, requiresConversationResolution },
});

/** Detail PR nodes by pull request id. */
export const detailsById: Record<string, ReturnType<typeof detailNode>> = {
  // 2 failing (one required), 11 passed, 1 skipped; changes requested; conversations must resolve.
  [prId(2481, 'acme/web')]: detailNode({
    checks: [
      run('unit tests (ubuntu)'),
      run('build', 'FAILURE', { isRequired: true }),
      run('lint'),
      run('e2e (chromium)', 'FAILURE'),
      run('typecheck', 'SUCCESS', { isRequired: true }),
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((shard) => run(`unit tests (shard ${shard})`)),
      run('docs preview', 'SKIPPED'),
      statusContextNode('ci/legacy-deploy', 'SUCCESS', {
        targetUrl: 'https://deploy.example/builds/9',
      }),
    ],
    latestReviews: { nodes: [review('alice', 'CHANGES_REQUESTED'), review('bob', 'APPROVED')] },
    reviewRequests: { nodes: [asked('carol')] },
    baseRef: rule(2, true),
  }),
  // Conflicts and no approval yet.
  [prId(377, 'acme/mobile')]: detailNode({
    checks: [run('ios build'), run('android build'), run('unit tests')],
    reviewRequests: { nodes: [asked('alice'), asked('erin')] },
    baseRef: rule(1),
  }),
  // Approved and clean.
  [prId(912, 'acme/api')]: detailNode({
    checks: [run('test', 'SUCCESS', { isRequired: true }), run('lint')],
    latestReviews: { nodes: [review('carol', 'APPROVED')] },
    baseRef: rule(1),
  }),
};

/** Answers `ProwlPullRequestDetail` from `detailsById` (an empty detail for any other PR). */
export function mockDetail(github: MockGitHub): void {
  github.onGraphQL('ProwlPullRequestDetail', ({ id }) =>
    detailResponse(detailsById[String(id)] ?? detailNode({ baseRef: null })),
  );
}
