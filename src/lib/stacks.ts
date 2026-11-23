/**
 * GitHub stacks in the list: a section's pull requests become items, a pull request on its own
 * or one GitHub stack holding its members, in place of the first member the order meets. Only
 * open PRs GitHub puts in a stack (`PullRequest.stack`) are grouped. Pure.
 */
import { failingChecksBlock, isReadyToMerge } from './mergeEligibility';
import type { PullRequest } from './model';

export type StackState = 'ready' | 'progress' | 'blocked' | 'draft';

export type ListItem =
  | { kind: 'pr'; pr: PullRequest }
  /** Members bottom (position 1, merges first) to top. */
  | { kind: 'stack'; id: string; members: PullRequest[] };

/**
 * One item per PR, except that the open members of a stack form one item where the first
 * appears. A merged or closed one is a plain card: the stack shows only what is left to merge
 * (`stackMembers`), so a search for merged PRs still lists them.
 */
export function listItems(prs: readonly PullRequest[]): ListItem[] {
  const items: ListItem[] = [];
  const stacks = new Map<string, PullRequest[]>();
  for (const pr of prs) {
    if (!pr.stack || pr.state !== 'open') {
      items.push({ kind: 'pr', pr });
      continue;
    }
    const members = stacks.get(pr.stack.id);
    if (members) members.push(pr);
    else {
      const created = [pr];
      stacks.set(pr.stack.id, created);
      items.push({ kind: 'stack', id: pr.stack.id, members: created });
    }
  }
  for (const members of stacks.values())
    members.sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0));
  return items;
}

/**
 * Every open pull request of stack `id` that Prowl knows, from all sections
 * (`Snapshot.pullRequests`), bottom to top: a section shows only some of them, the stack's
 * progress counts them all. One just merged or closed stays in the snapshot for a poll, still
 * with its `stack`: it is no longer part of what is left to merge.
 */
export function stackMembers(prs: Iterable<PullRequest>, id: string): PullRequest[] {
  return [...prs]
    .filter((pr) => pr.stack?.id === id && pr.state === 'open')
    .sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0));
}

/** Where a member stands: draft, ready to merge, blocked (red CI, changes, conflicts), else in progress. */
export function stackState(pr: PullRequest): StackState {
  if (pr.isDraft) return 'draft';
  if (isReadyToMerge(pr)) return 'ready';
  if (
    failingChecksBlock(pr) ||
    pr.reviewDecision === 'changes_requested' ||
    pr.mergeable === 'conflicting'
  )
    return 'blocked';
  return 'progress';
}

/**
 * The stack's counts, how many of its pull requests are open (`total`), and the members that can
 * merge now: the ready run from the lowest open position (GitHub's `bottom`, else 1) with none
 * missing, which GitHub merges in one go by merging the top one. A bottom Prowl does not know
 * (in none of the viewer's sections) merges nothing: GitHub would merge it unseen.
 */
export function stackSummary(members: readonly PullRequest[]) {
  const counts: Record<StackState, number> = { ready: 0, progress: 0, blocked: 0, draft: 0 };
  for (const pr of members) counts[stackState(pr)] += 1;
  const stack = members[0]?.stack;
  const bottom = stack?.bottom ?? 1;
  const mergeable: PullRequest[] = [];
  for (const pr of members) {
    if (pr.stack?.position !== bottom + mergeable.length || stackState(pr) !== 'ready') break;
    mergeable.push(pr);
  }
  return { counts, mergeable, total: stack?.open ?? stack?.size ?? members.length };
}
