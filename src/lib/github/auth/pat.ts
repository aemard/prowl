/**
 * Personal access token sign-in: checks a pasted token against GitHub and builds the
 * `AuthState` to store. The token never appears in anything returned or thrown from here
 * except the `AuthState` itself (the client masks it in GitHub's messages).
 */
import { env } from '../../env';
import type { AuthState, Viewer } from '../../model';
import { createGitHubClient, type FetchLike } from '../client';
import { GitHubError } from '../errors';
import { hasReadOrg } from '../teams';

const VIEWER_QUERY = 'query ProwlViewer { viewer { login avatarUrl name } }';

/**
 * Every GitHub token (`ghp_`, `github_pat_`, the 40 hex digits of old classic ones) is letters,
 * digits and underscores. Anything else (spaces, quotes, a pasted sentence) would not even
 * survive as a header value, so it is refused before the token is sent anywhere.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_]+$/;

/**
 * Token creation pages with the form filled in (GitHub's template URLs). Classic: the `repo`
 * and `read:org` (team review requests) scopes. Fine-grained: write access to what approving,
 * merging and re-running need, read access to commit statuses; Metadata read is always
 * granted. GitHub has no Checks permission for fine-grained tokens, so there is nothing to
 * pre-fill for it.
 */
export const TOKEN_URLS = {
  classic: `${env.webUrl}/settings/tokens/new?scopes=repo,read:org&description=Prowl`,
  fineGrained: `${env.webUrl}/settings/personal-access-tokens/new?name=Prowl&description=Prowl+side+panel&pull_requests=write&contents=write&actions=write&statuses=read`,
} as const;

export type TokenType = AuthState['tokenType'];

/** The type GitHub's token prefix announces; `unknown` for old 40-digit tokens and the rest. */
export function detectTokenType(token: string): TokenType {
  if (token.startsWith('github_pat_')) return 'fine_grained';
  if (token.startsWith('ghp_')) return 'classic';
  if (token.startsWith('gho_')) return 'oauth';
  return 'unknown';
}

/** `X-OAuth-Scopes` ("repo, read:org") as a list; null when GitHub sent no such header. */
function parseScopes(header: string | null): string[] | null {
  return header === null
    ? null
    : header
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean);
}

const NO_REPO_SCOPE =
  'This token has no repo scope, so Prowl can only see public repositories. Create a token with the repo scope to follow private ones.';
const NO_READ_ORG_SCOPE =
  'Without the read:org scope, Team reviews may not find your teams: add it to follow the pull requests your teams are asked to review.';
const NO_CHECKS_PERMISSION =
  'GitHub does not offer the Checks permission to fine-grained tokens, so CI status can be missing. A classic token with the repo scope shows it in full.';

/** Why the token works but not fully; null when nothing is known to be missing. */
function warningFor(tokenType: TokenType, scopes: string[] | null): string | null {
  if (tokenType === 'fine_grained') return NO_CHECKS_PERMISSION;
  if (scopes === null) return null;
  const warnings = [
    scopes.includes('repo') ? '' : NO_REPO_SCOPE,
    hasReadOrg(scopes) ? '' : NO_READ_ORG_SCOPE,
  ];
  return warnings.filter(Boolean).join(' ') || null;
}

function toViewer(node: unknown): Viewer {
  const { login, avatarUrl, name } = (node ?? {}) as Record<string, unknown>;
  if (typeof login !== 'string' || typeof avatarUrl !== 'string') {
    throw new GitHubError('server', 'GitHub returned an unexpected response.');
  }
  return { login, avatarUrl, name: typeof name === 'string' ? name : null };
}

export interface PatValidation {
  auth: AuthState;
  /** Shown after signing in; null when the token has everything Prowl needs. */
  warning: string | null;
}

/**
 * Checks `token` with the GraphQL `viewer` (the API Prowl polls) and `GET /user` (the only
 * place GitHub reports a classic token's scopes). Throws `GitHubError`: `validation` for a
 * string that cannot be a token, `unauthorized` for one GitHub rejects, and so on; show
 * `signInErrorMessage(error)`. Fine-grained tokens have no scopes, so `scopes` is empty.
 */
export async function validatePat(
  token: string,
  { apiUrl = env.apiUrl, fetch }: { apiUrl?: string; fetch?: FetchLike } = {},
): Promise<PatValidation> {
  const trimmed = token.trim();
  if (trimmed === '') throw new GitHubError('validation', 'Paste a token to sign in.');
  if (!TOKEN_SHAPE.test(trimmed)) {
    throw new GitHubError(
      'validation',
      'That does not look like a GitHub token. Copy it again, without spaces or quotes.',
    );
  }

  const client = createGitHubClient({ token: trimmed, apiUrl, fetch });
  const [data, user] = await Promise.all([
    client.graphql<{ viewer: unknown }>(VIEWER_QUERY),
    client.restResponse('GET', '/user'),
  ]);

  const tokenType = detectTokenType(trimmed);
  const scopes = parseScopes(user.headers.get('x-oauth-scopes'));
  return {
    auth: {
      method: 'pat',
      token: trimmed,
      tokenType,
      scopes: scopes ?? [],
      viewer: toViewer(data.viewer),
      createdAt: new Date().toISOString(),
    },
    warning: warningFor(tokenType, scopes),
  };
}

/** What to tell the user when `validatePat` throws. Never contains the token. */
export function signInErrorMessage(error: unknown): string {
  if (!(error instanceof GitHubError)) return 'Could not sign in. Try again.';
  switch (error.kind) {
    case 'validation':
      return error.message;
    case 'unauthorized':
      return 'GitHub rejected this token. Check that you copied all of it and that it has not expired or been revoked.';
    case 'forbidden':
      return `GitHub refused this token: ${error.message}`;
    case 'rate_limited':
      return 'GitHub rate limit reached. Try again in a minute.';
    case 'network':
      return 'Could not reach GitHub. Check your connection and try again.';
    case 'server':
      return 'GitHub is having trouble right now. Try again in a moment.';
    default:
      return `GitHub returned an error: ${error.message}`;
  }
}
