/** HTTP-level builders for GitHub responses, shared by unit tests and the E2E mock. */

/** `x-ratelimit-*` headers; `reset` is epoch seconds, as GitHub sends it. */
export function rateLimitHeaders({
  limit = 5000,
  remaining = 4990,
  reset = 1_791_295_200,
} = {}): Record<string, string> {
  return {
    'x-ratelimit-limit': String(limit),
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': String(reset),
    'x-ratelimit-resource': 'graphql',
  };
}

/** The `rateLimit { limit cost remaining resetAt }` object of a GraphQL response. */
export function graphqlRateLimit({
  limit = 5000,
  cost = 1,
  remaining = 4990,
  resetAt = '2026-10-06T13:00:00Z',
} = {}) {
  return { limit, cost, remaining, resetAt };
}

/** One entry of a GraphQL `errors` array, shaped like GitHub's. */
export function graphqlError(
  type: string | undefined,
  message: string,
  path?: (string | number)[],
) {
  return { ...(type ? { type } : {}), ...(path ? { path } : {}), message };
}

/** A fetch `Response` with a JSON body (or an empty one when `body` is undefined). */
export function jsonResponse(
  body: unknown,
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}
