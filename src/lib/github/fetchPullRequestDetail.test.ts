import { describe, expect, it, vi } from 'vitest';
import {
  checkRunNode,
  detailNode,
  detailResponse,
  detailReview,
} from '../../../tests/fixtures/github';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import { buildPullRequest } from '../../test/panel';
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

/** Reads GraphQL detail normally, with a controlled applied-rules response. */
function withRules(rules: unknown, status = 200) {
  const fetch = vi.fn<FetchLike>(async (_url, init) =>
    init.method === 'GET'
      ? jsonResponse(rules, { status })
      : jsonResponse({ data: detailResponse(detailNode()) }),
  );
  return {
    client: createGitHubClient({ token: 'test-token', apiUrl: 'https://api.github.com', fetch }),
    fetch,
  };
}

it('intersects repository methods with applied branch rules and reads their requirements', async () => {
  const { client, fetch } = withRules([
    {
      type: 'pull_request',
      parameters: {
        allowed_merge_methods: ['squash'],
        required_approving_review_count: 3,
        required_review_thread_resolution: true,
      },
    },
  ]);
  const detail = await fetchPullRequestDetail(
    client,
    'PR_1',
    buildPullRequest({ baseRefName: 'release/v2' }),
  );
  expect(detail.allowedMergeMethods).toEqual(['squash']);
  expect(detail.requiredApprovals).toBe(3);
  expect(detail.requiresConversationResolution).toBe(true);
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(1);
  expect(fetch.mock.calls[1]?.[0]).toContain('/rules/branches/release%2Fv2');
});

it('excludes merge commits for required linear history', async () => {
  const { client } = withRules([{ type: 'required_linear_history', parameters: null }]);
  const detail = await fetchPullRequestDetail(
    client,
    'PR_1',
    buildPullRequest({ allowedMergeMethods: ['merge', 'squash', 'rebase'] }),
  );
  expect(detail.allowedMergeMethods).toEqual(['squash', 'rebase']);
});

it.each([403, 404])(
  'marks unavailable branch rules as unknown (%s), retaining loaded details',
  async (status) => {
    const { client } = withRules({ message: 'Not accessible' }, status);
    const detail = await fetchPullRequestDetail(client, 'PR_1', buildPullRequest());
    expect(detail.allowedMergeMethods).toBeUndefined();
    expect(detail.warnings?.join(' ')).toContain('Branch rules could not be verified');
  },
);

it.each([401, 429])('keeps global rule-read failures global (%s)', async (status) => {
  const { client } = withRules({ message: 'Stop' }, status);
  await expect(fetchPullRequestDetail(client, 'PR_1', buildPullRequest())).rejects.toHaveProperty(
    'kind',
    status === 401 ? 'unauthorized' : 'rate_limited',
  );
});

it.each([{}, [null]])(
  'does not turn malformed rules into an empty requirement list',
  async (rules) => {
    const { client } = withRules(rules);
    const detail = await fetchPullRequestDetail(client, 'PR_1', buildPullRequest());
    expect(detail.allowedMergeMethods).toBeUndefined();
    expect(detail.warnings?.length).toBeGreaterThan(0);
  },
);

it('preserves masked field context when detail fields are inaccessible', async () => {
  const { client } = setup(() =>
    jsonResponse({
      data: detailResponse(detailNode({ baseRef: null })),
      errors: [graphqlError('FORBIDDEN', 'test-token cannot read this rule', ['node', 'baseRef'])],
    }),
  );
  const detail = await fetchPullRequestDetail(client, 'PR_1');
  expect(detail.requiredApprovals).toBeNull();
  expect(detail.warnings?.join(' ')).toContain('[redacted] cannot read this rule (node.baseRef)');
});

it('explains when the readable rules allow no supported repository method', async () => {
  const { client } = withRules([
    { type: 'pull_request', parameters: { allowed_merge_methods: ['future-method'] } },
  ]);
  const detail = await fetchPullRequestDetail(client, 'PR_1', buildPullRequest());
  expect(detail.allowedMergeMethods).toEqual([]);
  expect(detail.warnings?.join(' ')).toContain('No supported merge method');
});
