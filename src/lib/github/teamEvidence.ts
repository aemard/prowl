/** Only complete membership and review requests can prove that a result is switched off. */
import type { TeamsState } from '../model';
import type { PullRequestNode } from './queries';
import { teamKey } from './teams';

export function teamEvidence(
  node: PullRequestNode,
  membership: Pick<TeamsState, 'teams' | 'error' | 'incomplete'> | null,
  off: readonly string[],
  readable: boolean,
): { drop: boolean; keys: string[] } {
  const requests = node.reviewRequests;
  const nodes = requests?.nodes;
  const reviewers = nodes?.map((entry) => entry?.requestedReviewer);
  // User entries have login. Empty Team objects or null entries indicate permission holes.
  if (
    !readable ||
    !membership ||
    membership.error ||
    membership.incomplete ||
    !reviewers ||
    reviewers.some((r) => !r || (!r.login && (!r.slug || !r.organization?.login)))
  ) {
    return { drop: false, keys: [] };
  }
  const member = new Set(membership.teams.map(teamKey));
  const keys = [
    ...new Set(
      reviewers.flatMap((r) =>
        r?.slug && r.organization?.login
          ? [teamKey({ org: r.organization.login, slug: r.slug })]
          : [],
      ),
    ),
  ].filter((key) => member.has(key));
  const complete =
    requests?.pageInfo?.hasNextPage === false &&
    requests.totalCount !== undefined &&
    requests.totalCount === nodes?.length;
  return { keys, drop: complete && keys.length > 0 && keys.every((key) => off.includes(key)) };
}
