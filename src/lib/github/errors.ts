/** Failures of the GitHub client, classified into the `ErrorKind`s of `src/lib/model.ts`. */
import type { ErrorKind } from '../model';

export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  readonly kind: ErrorKind;
  /** HTTP status; null when there was no response (network failure). */
  readonly status: number | null;
  /** ISO time the exhausted primary rate limit resets; null otherwise. */
  readonly resetAt: string | null;
  /** Seconds GitHub asked us to wait (`retry-after`; one minute for a secondary rate limit). */
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: ErrorKind,
    message: string,
    extra: { status?: number; resetAt?: string | null; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.kind = kind;
    this.status = extra.status ?? null;
    this.resetAt = extra.resetAt ?? null;
    this.retryAfterSeconds = extra.retryAfterSeconds ?? null;
  }
}

const RATE_LIMIT_MESSAGE = /rate limit|abuse detection/i;

/**
 * HTTP status -> kind. GitHub signals rate limits with 403 or 429 (primary: remaining 0,
 * secondary: `retry-after` or a message), so a 403 needs the headers and message to tell a
 * rate limit from a permission problem.
 */
export function classifyHttpStatus(
  status: number,
  { limited, message }: { limited: boolean; message: string },
): ErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 403)
    return limited || RATE_LIMIT_MESSAGE.test(message) ? 'rate_limited' : 'forbidden';
  if (status === 451) return 'forbidden';
  if (status === 404 || status === 410) return 'not_found';
  if (status >= 500) return 'server';
  // 400, 409, 422...: the request itself was refused. Below 400 (304, an unfollowed
  // redirect) is a non-2xx answer we cannot use.
  return status >= 400 ? 'validation' : 'server';
}

const GRAPHQL_KINDS: Record<string, ErrorKind> = {
  RATE_LIMITED: 'rate_limited',
  FORBIDDEN: 'forbidden',
  INSUFFICIENT_SCOPES: 'forbidden',
  NOT_FOUND: 'not_found',
  UNPROCESSABLE: 'validation',
};

/** GraphQL error `type` -> kind; anything unknown is a plain `graphql` error. */
export function classifyGraphQLType(type: unknown): ErrorKind {
  return (typeof type === 'string' && GRAPHQL_KINDS[type]) || 'graphql';
}
