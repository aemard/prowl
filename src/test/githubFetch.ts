/** Stubs the global `fetch` for the panel's one GitHub read, `ProwlPullRequestDetail`. */
import { vi } from 'vitest';
import { detailNode, detailResponse } from '../../tests/fixtures/github';
import { jsonResponse } from '../../tests/fixtures/http';
import type { DetailData } from '../lib/github/queries';

type Answer = DetailData['node'] | Response;

/**
 * Every request is answered with `respond(variables)`: a PR node (wrapped like GitHub would), or
 * a `Response` for failures. Returns the mock, whose calls are the requests sent.
 */
export function stubDetailFetch(
  respond: (variables: Record<string, unknown>) => Answer | Promise<Answer> = () => detailNode(),
) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const out = await respond(JSON.parse(String(init.body)).variables);
    return out instanceof Response ? out : jsonResponse({ data: detailResponse(out) });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
