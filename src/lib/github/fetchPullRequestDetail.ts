/**
 * The read behind an expanded card: `ProwlPullRequestDetail` for one PR, mapped to the model.
 */
import type { PullRequestDetail } from '../model';
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
): Promise<PullRequestDetail> {
  const read = async (after: string | null) => {
    const { node } = await client.graphql<DetailData>(
      DETAIL_QUERY,
      { id, after },
      { partial: true },
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
  return mapPullRequestDetail(pages);
}
