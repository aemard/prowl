import { vi } from 'vitest';
import {
  type FullPullRequestNode,
  mergeStateResponse,
  searchResponse,
} from '../../../tests/fixtures/github';
import { graphqlRateLimit, jsonResponse } from '../../../tests/fixtures/http';
import type { Section } from '../model';
import { createGitHubClient, type FetchLike } from './client';
import type { FetchSettings } from './fetchPullRequests';
import { mapPullRequest } from './mapPullRequest';
import type { PullRequestNode, SearchData } from './queries';

type Handler = (variables: Record<string, unknown>) => Response | Error | object;

/**
 * A client whose fetch answers each GraphQL operation with `handlers[name]`; `ProwlMergeState`
 * defaults to the facts of the PRs the searches returned.
 */
export function setup(handlers: Record<string, Handler>) {
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const searched = new Map<string, FullPullRequestNode>();
  const fetch = vi.fn<FetchLike>(async (_url, init) => {
    const { query, variables } = JSON.parse(String(init.body));
    const operation = /query (\w+)/.exec(query)?.[1] ?? '';
    calls.push({ operation, variables });
    const handler =
      handlers[operation] ??
      (operation === 'ProwlMergeState'
        ? ({ ids }: Record<string, unknown>) => mergeStateResponse(ids, [...searched.values()])
        : undefined);
    const out = handler?.(variables) ?? new Error(`unexpected ${operation}`);
    if (out instanceof Error) throw out;
    if (operation === 'ProwlSearch' && 'search' in out) {
      for (const node of (out as SearchData).search.nodes ?? []) {
        if (node && 'id' in node) searched.set(node.id, node as FullPullRequestNode);
      }
    }
    return out instanceof Response ? out : jsonResponse({ data: out });
  });
  const client = createGitHubClient({
    token: 'test-token',
    apiUrl: 'https://api.github.com',
    fetch,
  });
  const queries = () => calls.filter((c) => c.operation === 'ProwlSearch').map((c) => c.variables);
  return { client, calls, queries };
}

export const section = (kind: Section['kind'], extra: Partial<Section> = {}): Section => ({
  id: kind,
  kind,
  label: kind,
  enabled: true,
  ...extra,
});

export const settings = (overrides: Partial<FetchSettings> = {}): FetchSettings => ({
  sections: [section('authored')],
  repoInclude: [],
  repoExclude: [],
  maxPerSection: 50,
  unfollowedTeams: [],
  hideDrafts: false,
  hideBots: false,
  hideStaleAfterDays: 0,
  ...overrides,
});

/** A search handler that serves `nodes` for queries containing each key. */
export const bySearch =
  (results: Record<string, PullRequestNode[]>, rateLimit = graphqlRateLimit()) =>
  (variables: Record<string, unknown>) => {
    const key = Object.keys(results).find((k) => String(variables.query).includes(k));
    return searchResponse(key ? (results[key] ?? []) : [], variables, rateLimit);
  };

export const mapped = (node: PullRequestNode) => mapPullRequest(node);
