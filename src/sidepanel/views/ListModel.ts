/** Pure list logic for the pull request list: the quick filter and the sort order. */
import type { PullRequest, SortOrder } from '../../lib/model';

/**
 * Keeps the PRs matching every word of `query` (case-insensitive) in the repository, number,
 * title, author or a label name. An empty query keeps everything.
 */
export function filterPullRequests(prs: PullRequest[], query: string): PullRequest[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return prs;
  return prs.filter((pr) => {
    const haystack = [
      pr.repo.nameWithOwner,
      `#${pr.number}`,
      pr.title,
      pr.author?.login ?? '',
      ...pr.labels.map((label) => label.name),
    ]
      .join('\n')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

const newest = (key: 'updatedAt' | 'createdAt') => (a: PullRequest, b: PullRequest) =>
  Date.parse(b[key]) - Date.parse(a[key]);

/** A sorted copy: newest activity or creation first, or by repository then newest activity. */
export function sortPullRequests(prs: PullRequest[], order: SortOrder): PullRequest[] {
  const compare =
    order === 'repo'
      ? (a: PullRequest, b: PullRequest) =>
          a.repo.nameWithOwner.localeCompare(b.repo.nameWithOwner) || newest('updatedAt')(a, b)
      : newest(order === 'created' ? 'createdAt' : 'updatedAt');
  return [...prs].sort(compare);
}
