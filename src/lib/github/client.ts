/**
 * The one HTTP client for GitHub (GraphQL and REST). It runs in the service worker and the
 * side panel, so it only uses `fetch` and `AbortController`. It never retries: the poller owns
 * backoff. Every failure is a `GitHubError`; the token is masked in everything it carries.
 */
import { classifyGraphQLType, classifyHttpStatus, GitHubError } from './errors';
import { headerCount, resetAtFromHeaders } from './rateLimit';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface GitHubClientOptions {
  token: string;
  /** API base URL without a trailing slash, e.g. `https://api.github.com`. */
  apiUrl: string;
  /** Defaults to the global `fetch`, looked up on every call. */
  fetch?: FetchLike;
}

export interface GitHubClient {
  /**
   * Runs a GraphQL operation and returns its `data`. GitHub answers 200 even when a field
   * failed, so any entry in `errors` throws, unless `partial` is set and `data` came back
   * too (a deleted node, an org that requires SAML): then the partial data is returned.
   * Mutations must stay strict, their payload is null when they fail.
   */
  graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
    options?: { partial?: boolean },
  ): Promise<T>;
  /** Calls a REST endpoint (`path` starts with `/`). Resolves to `undefined` for empty bodies. */
  rest<T = void>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
  /** Like `rest`, plus the response headers (e.g. `x-oauth-scopes` of `GET /user`). */
  restResponse<T = void>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<{ data: T; headers: Headers }>;
}

const TIMEOUT_MS = 20_000;
const API_VERSION = '2022-11-28';
/** GitHub: without `retry-after`, wait at least a minute after a secondary rate limit. */
const SECONDARY_RETRY_SECONDS = 60;
const MAX_MESSAGE_LENGTH = 300;
const UNEXPECTED = 'GitHub returned an unexpected response.';
const UNPARSEABLE = Symbol('unparseable');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function createGitHubClient({
  token,
  apiUrl,
  fetch: fetchImpl,
}: GitHubClientOptions): GitHubClient {
  const base = apiUrl.replace(/\/+$/, '');

  /** Text from GitHub is untrusted: mask the token, bound the length. */
  const clean = (text: string) =>
    (token === '' ? text : text.split(token).join('[redacted]')).slice(0, MAX_MESSAGE_LENGTH);

  function fail(kind: GitHubError['kind'], message: string, status: number, headers: Headers) {
    let retryAfterSeconds = headerCount(headers, 'retry-after');
    let resetAt: string | null = null;
    if (kind === 'rate_limited') {
      if (headerCount(headers, 'x-ratelimit-remaining') === 0)
        resetAt = resetAtFromHeaders(headers);
      if (retryAfterSeconds === null && resetAt === null)
        retryAfterSeconds = SECONDARY_RETRY_SECONDS;
    }
    return new GitHubError(kind, message, { status, resetAt, retryAfterSeconds });
  }

  function httpError({ status, headers }: Response, payload: unknown) {
    const message =
      isRecord(payload) && typeof payload.message === 'string' ? clean(payload.message) : '';
    const limited =
      headerCount(headers, 'x-ratelimit-remaining') === 0 ||
      headerCount(headers, 'retry-after') !== null;
    const kind = classifyHttpStatus(status, { limited, message });
    return fail(kind, message || `GitHub responded with HTTP ${status}.`, status, headers);
  }

  async function send(method: HttpMethod, path: string, body: unknown, rest: boolean) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    };
    if (rest) headers['X-GitHub-Api-Version'] = API_VERSION;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await (fetchImpl ?? ((input, init) => fetch(input, init)))(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // GET responses are cacheable for a minute; polling and re-reads need fresh data.
        cache: 'no-store',
        // The token authenticates; a host permission would otherwise attach the site's cookies.
        credentials: 'omit',
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      // The cause is dropped on purpose: whatever fetch threw may mention the request.
      throw new GitHubError(
        'network',
        timedOut
          ? `GitHub did not respond within ${TIMEOUT_MS / 1000} seconds.`
          : 'Could not reach GitHub.',
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown;
    try {
      payload = text === '' ? undefined : JSON.parse(text);
    } catch {
      payload = UNPARSEABLE;
    }
    if (!response.ok) throw httpError(response, payload);
    return { response, payload };
  }

  async function restResponse<T = void>(method: HttpMethod, path: string, body?: unknown) {
    const { response, payload } = await send(method, path, body, true);
    if (payload === UNPARSEABLE)
      throw fail('server', UNEXPECTED, response.status, response.headers);
    return { data: payload as T, headers: response.headers };
  }

  return {
    async graphql<T>(
      query: string,
      variables: Record<string, unknown> = {},
      { partial = false }: { partial?: boolean } = {},
    ) {
      const { response, payload } = await send('POST', '/graphql', { query, variables }, false);
      const { status, headers } = response;
      if (!isRecord(payload)) throw fail('server', UNEXPECTED, status, headers);
      const { data, errors } = payload;
      const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
      if (first !== undefined && !(partial && isRecord(data))) {
        const { type, message } = isRecord(first) ? first : ({} as Record<string, unknown>);
        throw fail(
          classifyGraphQLType(type),
          typeof message === 'string' && message ? clean(message) : 'GitHub returned an error.',
          status,
          headers,
        );
      }
      if (!isRecord(data)) throw fail('server', 'GitHub returned no data.', status, headers);
      return data as T;
    },

    async rest<T = void>(method: HttpMethod, path: string, body?: unknown) {
      return (await restResponse<T>(method, path, body)).data;
    },

    restResponse,
  };
}
