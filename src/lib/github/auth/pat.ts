/**
 * Personal access token sign-in: checks a pasted token against GitHub and builds the
 * `AuthState` to store. The token never appears in anything returned or thrown from here
 * except the `AuthState` itself (the client masks it in GitHub's messages).
 */
import { env } from '../../env';
import { t } from '../../i18n';
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

const NO_REPO_SCOPE = t('noRepoScope');
const NO_READ_ORG_SCOPE = t('withoutTheReadOrgScopeTeamReviewsMayNot');
const NO_CHECKS_PERMISSION = t('githubDoesNotOfferTheChecksPermissionToFine');

const EXPIRATION = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{2}:?\d{2})$/;

/**
 * `GitHub-Authentication-Token-Expiration` ("2026-11-30 12:00:00 UTC", or with a "+0100" offset)
 * as an ISO time. GitHub sends it for tokens that expire: no header is null (never expires), a
 * header Prowl cannot read is undefined (unknown).
 */
export function parseTokenExpiration(header: string | null): string | null | undefined {
  if (header === null) return null;
  const [, date, time, zone] = EXPIRATION.exec(header.trim()) ?? [];
  if (!date || !time || !zone) return undefined;
  const offset = zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const ms = Date.parse(`${date}T${time}${offset}`);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

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
    throw new GitHubError('server', t('githubReturnedAnUnexpectedResponse'));
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
  if (trimmed === '') throw new GitHubError('validation', t('pasteATokenToSignIn'));
  if (!TOKEN_SHAPE.test(trimmed)) {
    throw new GitHubError('validation', t('thatDoesNotLookLikeAGithubTokenCopy'));
  }

  const client = createGitHubClient({ token: trimmed, apiUrl, fetch });
  const [data, user] = await Promise.all([
    client.graphql<{ viewer: unknown }>(VIEWER_QUERY),
    client.restResponse('GET', '/user'),
  ]);

  const tokenType = detectTokenType(trimmed);
  const scopes = parseScopes(user.headers.get('x-oauth-scopes'));
  const expiresAt = parseTokenExpiration(
    user.headers.get('github-authentication-token-expiration'),
  );
  return {
    auth: {
      method: 'pat',
      token: trimmed,
      tokenType,
      scopes: scopes ?? [],
      viewer: toViewer(data.viewer),
      createdAt: new Date().toISOString(),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    },
    warning: warningFor(tokenType, scopes),
  };
}

/** What to tell the user when `validatePat` throws. Never contains the token. */
export function signInErrorMessage(error: unknown): string {
  if (!(error instanceof GitHubError)) return t('couldNotSignInTryAgain');
  switch (error.kind) {
    case 'validation':
      return error.message;
    case 'unauthorized':
      return t('githubRejectedThisTokenCheckThatYouCopiedAll');
    case 'forbidden':
      return t('githubRefusedThisToken', error.message);
    case 'rate_limited':
      return t('githubRateLimitReachedTryAgainInAMinute');
    case 'network':
      return t('couldNotReachGithubCheckYourConnectionAndTry');
    case 'server':
      return t('githubIsHavingTroubleRightNowTryAgainIn');
    default:
      return t('githubErrorDetail', error.message);
  }
}
