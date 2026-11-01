/**
 * The read behind an expanded card: `ProwlPullRequestDetail` for one PR, mapped to the model.
 */
import type { PullRequest, PullRequestDetail } from '../model';
import { isRecord } from '../storage/guards';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';
import { mapPullRequestDetail } from './mapPullRequest';
import { DETAIL_QUERY, type DetailData, type DetailPullRequestNode } from './queries';

/** Pages of 100 check contexts read at most: a PR with more shows "N more on GitHub". */
const MAX_PAGES = 5;

const isPullRequest = (node: DetailData['node']): node is DetailPullRequestNode =>
  node !== null && 'commits' in node;

/**
 * Fetches the checks, reviewers and branch rules of pull request `id`, paging through up to
 * `MAX_PAGES` x 100 check contexts. The read is partial: a hole (check runs a fine-grained token
 * cannot read) leaves that part empty instead of failing the rest. Throws `GitHubError`
 * (`not_found` when the PR is gone or hidden).
 */
export async function fetchPullRequestDetail(
  client: GitHubClient,
  id: string,
  pr?: Pick<PullRequest, 'repo' | 'baseRefName' | 'allowedMergeMethods'>,
): Promise<PullRequestDetail> {
  const problems: string[] = [];
  const read = async (after: string | null) => {
    const { node } = await client.graphql<DetailData>(
      DETAIL_QUERY,
      { id, after },
      { partial: true, onPartialErrors: (messages) => problems.push(...messages) },
    );
    if (!isPullRequest(node))
      throw new GitHubError('not_found', 'This pull request is not available.');
    return node;
  };
  const contextsOf = (node: DetailPullRequestNode) =>
    node.commits.nodes?.at(-1)?.commit.statusCheckRollup?.contexts;

  const first = await read(null);
  const pages: [DetailPullRequestNode, ...DetailPullRequestNode[]] = [first];
  let { pageInfo } = contextsOf(first) ?? {};
  while (pageInfo?.hasNextPage && pages.length < MAX_PAGES) {
    const next = await read(pageInfo.endCursor);
    pages.push(next);
    pageInfo = contextsOf(next)?.pageInfo;
  }
  let detail = mapPullRequestDetail(pages);
  if (problems.length) {
    detail.warnings = [
      ...(detail.warnings ?? []),
      `Some details could not be read: ${[...new Set(problems)].slice(0, 5).join(' ')}`,
    ];
  }
  if (pr) detail = await applyBranchRules(client, pr, detail);
  return detail;
}

/** Applied branch rules, not all rulesets of a repository. Read only on card expansion. */
async function applyBranchRules(
  client: GitHubClient,
  pr: Pick<PullRequest, 'repo' | 'baseRefName' | 'allowedMergeMethods'>,
  detail: PullRequestDetail,
): Promise<PullRequestDetail> {
  const path = `/repos/${encodeURIComponent(pr.repo.owner)}/${encodeURIComponent(pr.repo.name)}/rules/branches/${encodeURIComponent(pr.baseRefName)}`;
  try {
    const rules = await client.rest<unknown>('GET', path);
    if (!Array.isArray(rules)) throw new GitHubError('server', 'Branch rules unavailable.');
    let methods = [...pr.allowedMergeMethods];
    let requiredApprovals = detail.requiredApprovals;
    let conversations = detail.requiresConversationResolution;
    for (const rule of rules) {
      if (!isRecord(rule) || typeof rule.type !== 'string')
        throw new GitHubError('server', 'Invalid branch rules.');
      if (rule.type === 'required_linear_history')
        methods = methods.filter((method) => method !== 'merge');
      if (rule.type !== 'pull_request' || !isRecord(rule.parameters)) continue;
      const params = rule.parameters;
      const allowed = params.allowed_merge_methods;
      if (Array.isArray(allowed)) methods = methods.filter((method) => allowed.includes(method));
      if (
        typeof params.required_approving_review_count === 'number' &&
        Number.isInteger(params.required_approving_review_count) &&
        params.required_approving_review_count >= 0
      ) {
        requiredApprovals = Math.max(
          requiredApprovals ?? 0,
          params.required_approving_review_count,
        );
      }
      conversations ||= params.required_review_thread_resolution === true;
    }
    return {
      ...detail,
      allowedMergeMethods: methods,
      requiredApprovals,
      requiresConversationResolution: conversations,
      ...(methods.length === 0
        ? {
            warnings: [
              ...(detail.warnings ?? []),
              'No supported merge method is allowed by the readable repository and branch rules. Use GitHub to inspect the available options.',
            ],
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof GitHubError && ['unauthorized', 'rate_limited'].includes(error.kind))
      throw error;
    return {
      ...detail,
      warnings: [
        ...(detail.warnings ?? []),
        'Branch rules could not be verified. Merge methods follow repository settings; GitHub may restrict them further.',
      ],
    };
  }
}
