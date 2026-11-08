import { vi } from 'vitest';
import {
  type FullPullRequestNode,
  headCommit,
  mergeStateResponse,
  prId,
  prNode,
  searchResponse,
} from '../../tests/fixtures/github';
import { jsonResponse } from '../../tests/fixtures/http';
import type { SearchData } from '../lib/github/queries';
import type { AuthState, CheckState, PollState } from '../lib/model';
import { getItem, setItem } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { buildAuth } from '../test/panel';
import { POLL_ALARM } from './poller';

export const NOW = Date.parse('2026-10-06T12:00:00.000Z');
export const MINUTE = 60_000;
export const at = (ms: number) => new Date(ms).toISOString();
export const PR = prId(1);
export const CHECKS: Record<CheckState, Record<string, number> | null> = {
  success: { SUCCESS: 2 },
  failure: { SUCCESS: 1, FAILURE: 1 },
  pending: { SUCCESS: 1, IN_PROGRESS: 1 },
  none: null,
};

type Reply = (query: string | undefined) => Response | object | Promise<Response | object>;

/** `GET /user/teams` calls of the current test (kept out of the GraphQL `requests`). */
export let teamCalls = 0;

/**
 * Stubs `fetch` as GitHub: every GraphQL request gets `reply(search query)`, every
 * `GET /user/teams` gets `teams()` (no team by default). `ProwlMergeState` gets the facts of the
 * PRs the last search returned and stays out of `requests`, like the teams.
 */
export function github(
  reply: Reply = () => searchResponse([prNode()]),
  teams: () => Response | Promise<Response> = () => jsonResponse([]),
  merge?: (ids: string[], nodes: FullPullRequestNode[]) => Response | Promise<Response>,
) {
  teamCalls = 0;
  let searched: FullPullRequestNode[] = [];
  const requests: { operation: string; query?: string; token: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/user/teams?')) {
        teamCalls += 1;
        return teams();
      }
      const { query, variables } = JSON.parse(String(init.body));
      if (query.includes('query ProwlMergeState')) {
        return merge
          ? merge(variables.ids, searched)
          : jsonResponse({ data: mergeStateResponse(variables.ids, searched) });
      }
      const token = new Headers(init.headers).get('authorization');
      requests.push({
        operation: /query (\w+)/.exec(query)?.[1] ?? '',
        query: variables.query,
        token,
      });
      const out = await reply(variables.query);
      if (!(out instanceof Response) && 'search' in out) {
        searched = ((out as SearchData).search.nodes ?? []) as FullPullRequestNode[];
      }
      return out instanceof Response ? out : jsonResponse({ data: out });
    }),
  );
  return requests;
}

export const fail =
  (status: number, message: string, headers: Record<string, string> = {}): Reply =>
  () =>
    jsonResponse({ message }, { status, headers });
export const searchWith = (checks: CheckState) => () =>
  searchResponse([prNode({ commits: headCommit(CHECKS[checks]) })]);

export const signIn = (auth: AuthState = buildAuth()) => setItem('auth', auth);
export const pollState = async () => (await getItem('pollState')) as PollState;
export const alarm = () => fakeChrome().__state.alarms.get(POLL_ALARM);
export const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
