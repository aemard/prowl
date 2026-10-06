import { describe, expect, it, vi } from 'vitest';
import {
  checkRunNode,
  detailNode,
  detailResponse,
  detailReview,
} from '../../../tests/fixtures/github';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';
import { fetchPullRequestDetail } from './fetchPullRequestDetail';
import type { DetailData } from './queries';

/** A client whose fetch answers every request with `answer(variables)`. */
function setup(answer: (variables: Record<string, unknown>) => Response | DetailData) {
  const variables: Record<string, unknown>[] = [];
  const fetch = vi.fn<FetchLike>(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    variables.push(body.variables);
    const out = answer(body.variables);
    return out instanceof Response ? out : jsonResponse({ data: out });
  });
  const client = createGitHubClient({
    token: 'test-token',
    apiUrl: 'https://api.github.com',
    fetch,
  });
  return { client, variables };
}

describe('fetchPullRequestDetail', () => {
  it('reads one page of a small PR and maps it', async () => {
    const { client, variables } = setup((v) =>
      detailResponse(
        detailNode({
          checks: [checkRunNode('lint'), checkRunNode('build', 'FAILURE')],
          latestReviews: { nodes: [detailReview('alice')] },
          after: v.after,
        }),
      ),
    );
    const detail = await fetchPullRequestDetail(client, 'PR_1');
    expect(variables).toEqual([{ id: 'PR_1', after: null }]);
    expect(detail.checks.map((c) => c.name)).toEqual(['build', 'lint']);
    expect(detail.reviewers).toEqual([
      { login: 'alice', avatarUrl: expect.stringContaining('avatars'), state: 'approved' },
    ]);
    expect(detail.requiredApprovals).toBe(1);
  });

  it('follows the cursor through the pages of checks, up to a cap', async () => {
    const checks = Array.from({ length: 20 }, (_, i) => checkRunNode(`job-${i}`));
    const small = setup((v) => detailResponse(detailNode({ checks, pageSize: 8, after: v.after })));
    const detail = await fetchPullRequestDetail(small.client, 'PR_1');
    expect(small.variables.map((v) => v.after)).toEqual([null, '8', '16']);
    expect(detail.checks).toHaveLength(20);

    const many = Array.from({ length: 600 }, (_, i) => checkRunNode(`job-${i}`));
    const capped = setup((v) => detailResponse(detailNode({ checks: many, after: v.after })));
    const partial = await fetchPullRequestDetail(capped.client, 'PR_1');
    expect(capped.variables).toHaveLength(5);
    expect(partial.checks).toHaveLength(500);
    expect(partial.checksTotal).toBe(600);
  });

  it('stops paging when a later page loses its rollup', async () => {
    const checks = Array.from({ length: 4 }, (_, i) => checkRunNode(`job-${i}`));
    const { client, variables } = setup((v) =>
      detailResponse(
        v.after === null
          ? detailNode({ checks, pageSize: 2 })
          : detailNode({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }),
      ),
    );
    const detail = await fetchPullRequestDetail(client, 'PR_1');
    expect(variables).toHaveLength(2);
    expect(detail.checks).toHaveLength(2);
  });

  it('reads a PR whose commit has no checks in one request', async () => {
    const { client, variables } = setup(() =>
      detailResponse(detailNode({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })),
    );
    expect(await fetchPullRequestDetail(client, 'PR_1')).toMatchObject({
      checks: [],
      checksTotal: 0,
    });
    expect(variables).toHaveLength(1);
  });

  it('throws not_found for a PR that is gone, hidden or not a PR at all', async () => {
    for (const node of [null, {}]) {
      const { client } = setup(() => detailResponse(node));
      await expect(fetchPullRequestDetail(client, 'PR_1')).rejects.toMatchObject({
        kind: 'not_found',
      });
    }
  });

  it('keeps what GitHub could read when a part failed (partial read)', async () => {
    const { client } = setup(() =>
      jsonResponse({
        data: detailResponse(detailNode({ latestReviews: { nodes: [detailReview('alice')] } })),
        errors: [graphqlError('FORBIDDEN', 'Resource not accessible by personal access token')],
      }),
    );
    const detail = await fetchPullRequestDetail(client, 'PR_1');
    expect(detail.reviewers).toHaveLength(1);
  });

  it('passes GitHub failures on as GitHubError', async () => {
    const { client } = setup(() => jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    await expect(fetchPullRequestDetail(client, 'PR_1')).rejects.toBeInstanceOf(GitHubError);
    const failing = setup(() =>
      jsonResponse({ errors: [graphqlError('RATE_LIMITED', 'API rate limit exceeded')] }),
    );
    await expect(fetchPullRequestDetail(failing.client, 'PR_1')).rejects.toMatchObject({
      kind: 'rate_limited',
    });
  });
});
