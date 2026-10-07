/** Pure logic of the pull request list: quick filter, sort order, and the PRs set aside. */
import { type HiddenReason, type HideSettings, hiddenReasons } from '../../lib/hidden';
import type { PrLocalState, PullRequest, SortOrder } from '../../lib/model';
import { isSnoozed } from '../../lib/storage/prLocal';

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

/** The PRs of one section, split the way the list shows them. Each part keeps the given order. */
export interface SectionParts {
  /** Cards, and the section's count. */
  shown: PullRequest[];
  /** Behind "Show N hidden", with why each one is hidden. */
  hidden: { pr: PullRequest; reasons: HiddenReason[] }[];
  /** Behind "Snoozed (N)". A snoozed PR is there even when it would also be hidden. */
  snoozed: PullRequest[];
}

export function splitSection(
  prs: PullRequest[],
  local: PrLocalState,
  hide: HideSettings,
  now: number,
): SectionParts {
  const parts: SectionParts = { shown: [], hidden: [], snoozed: [] };
  for (const pr of prs) {
    const reasons = hiddenReasons(pr, hide, now);
    if (isSnoozed(local, pr.id, now)) parts.snoozed.push(pr);
    else if (reasons.length > 0) parts.hidden.push({ pr, reasons });
    else parts.shown.push(pr);
  }
  return parts;
}
