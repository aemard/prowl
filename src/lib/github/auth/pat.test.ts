import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewerNode } from '../../../../tests/fixtures/github';
import { graphqlError, jsonResponse } from '../../../../tests/fixtures/http';
import type { FetchLike } from '../client';
import { GitHubError } from '../errors';
import { detectTokenType, signInErrorMessage, TOKEN_URLS, validatePat } from './pat';

const CLASSIC = 'ghp_ClassicTokenValue0123456789abcdefABCD';
const FINE_GRAINED = 'github_pat_11ABCDEFG0abcdefghijklmn_FineGrainedTokenValue0123456789';
const NOW = '2026-10-06T12:00:00.000Z';

afterEach(() => {
  vi.useRealTimers();
});

/** Answers the GraphQL viewer query and `GET /user` (with the scopes header) in either order. */
function github({
  viewer = viewerNode(),
  scopes = 'repo, read:org',
  graphql,
  user,
}: {
  viewer?: unknown;
  scopes?: string | null;
  graphql?: Response;
  user?: Response;
} = {}) {
  return vi.fn<FetchLike>(async (url) => {
    if (url.endsWith('/graphql')) return graphql ?? jsonResponse({ data: { viewer } });
    return (
      user ??
      jsonResponse(
        { login: 'octocat' },
        { headers: scopes === null ? {} : { 'x-oauth-scopes': scopes } },
      )
    );
  });
}

describe('detectTokenType', () => {
  it.each([
    [CLASSIC, 'classic'],
    [FINE_GRAINED, 'fine_grained'],
    ['gho_OAuthAccessToken', 'oauth'],
    ['0123456789abcdef0123456789abcdef01234567', 'unknown'],
    ['ghs_InstallationToken', 'unknown'],
  ])('%s is %s', (token, type) => {
    expect(detectTokenType(token)).toBe(type);
  });
});

describe('TOKEN_URLS', () => {
  it('pre-fill the classic scope and the fine-grained permissions', () => {
    const classic = new URL(TOKEN_URLS.classic);
    expect(`${classic.origin}${classic.pathname}`).toBe('https://github.com/settings/tokens/new');
    expect(Object.fromEntries(classic.searchParams)).toEqual({
      scopes: 'repo,read:org',
      description: 'Prowl',
    });

    const fine = new URL(TOKEN_URLS.fineGrained);
    expect(`${fine.origin}${fine.pathname}`).toBe(
      'https://github.com/settings/personal-access-tokens/new',
    );
    expect(Object.fromEntries(fine.searchParams)).toEqual({
      name: 'Prowl',
      description: 'Prowl side panel',
      pull_requests: 'write',
      contents: 'write',
      actions: 'write',
      statuses: 'read',
    });
  });
});

describe('validatePat', () => {
  it('builds the AuthState from the viewer and the scopes header', async () => {
    vi.useFakeTimers({ now: Date.parse(NOW), toFake: ['Date'] });
    const fetch = github();
    const { auth, warning } = await validatePat(`  ${CLASSIC}\n`, { fetch });

    expect(auth).toEqual({
      method: 'pat',
      token: CLASSIC,
      tokenType: 'classic',
      scopes: ['repo', 'read:org'],
      viewer: viewerNode(),
      createdAt: NOW,
    });
    expect(warning).toBeNull();

    const calls = fetch.mock.calls.map(([url, init]) => [url, init.method]);
    expect(calls).toEqual(
      expect.arrayContaining([
        ['https://api.github.com/graphql', 'POST'],
        ['https://api.github.com/user', 'GET'],
      ]),
    );
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ Authorization: `Bearer ${CLASSIC}` });
  });

  it('honours a custom API URL', async () => {
    const fetch = github();
    await validatePat(CLASSIC, { apiUrl: 'http://127.0.0.1:4010/', fetch });
    expect(fetch.mock.calls[0]?.[0]).toMatch(/^http:\/\/127\.0\.0\.1:4010\//);
  });

  it('warns when a classic token has no repo scope, and says which scopes it has', async () => {
    const { auth, warning } = await validatePat(CLASSIC, {
      fetch: github({ scopes: 'public_repo, read:user' }),
    });
    expect(auth.scopes).toEqual(['public_repo', 'read:user']);
    expect(warning).toMatch(/no repo scope/);
  });

  it('warns about a token with no scopes at all (empty header)', async () => {
    const { auth, warning } = await validatePat(CLASSIC, { fetch: github({ scopes: '' }) });
    expect(auth.scopes).toEqual([]);
    expect(warning).toMatch(/no repo scope.* Without the read:org scope/);
  });

  it.each(['repo', 'repo, user'])(
    'warns (and still signs in) when a %s token has no read:org',
    async (scopes) => {
      const { auth, warning } = await validatePat(CLASSIC, { fetch: github({ scopes }) });
      expect(auth.viewer).toEqual(viewerNode());
      expect(warning).toBe(
        'Without the read:org scope, Team reviews may not find your teams: add it to follow the pull requests your teams are asked to review.',
      );
    },
  );

  it.each(['repo, read:org', 'repo, admin:org', 'repo, write:org'])(
    'does not warn when %s includes read:org',
    async (scopes) => {
      expect((await validatePat(CLASSIC, { fetch: github({ scopes }) })).warning).toBeNull();
    },
  );

  it('does not warn about scopes when GitHub sent no header (unknown token type)', async () => {
    const { auth, warning } = await validatePat('0123456789abcdef0123456789abcdef01234567', {
      fetch: github({ scopes: null }),
    });
    expect(auth.tokenType).toBe('unknown');
    expect(auth.scopes).toEqual([]);
    expect(warning).toBeNull();
  });

  it('stores no scopes for a fine-grained token and explains the missing Checks permission', async () => {
    const { auth, warning } = await validatePat(FINE_GRAINED, { fetch: github({ scopes: null }) });
    expect(auth.tokenType).toBe('fine_grained');
    expect(auth.scopes).toEqual([]);
    expect(warning).toMatch(/Checks permission/);
  });

  it('keeps a missing display name as null', async () => {
    const { auth } = await validatePat(CLASSIC, {
      fetch: github({ viewer: { login: 'octocat', avatarUrl: 'https://a/b.png', name: null } }),
    });
    expect(auth.viewer).toEqual({ login: 'octocat', avatarUrl: 'https://a/b.png', name: null });
  });

  it.each([
    ['', 'Paste a token'],
    ['   ', 'Paste a token'],
    ['ghp_has space', 'does not look like a GitHub token'],
    ['"ghp_quoted"', 'does not look like a GitHub token'],
    ['Authorization: Bearer ghp_x', 'does not look like a GitHub token'],
  ])('refuses %j without calling GitHub', async (input, message) => {
    const fetch = github();
    const error = await validatePat(input, { fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('validation');
    expect((error as GitHubError).message).toContain(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a token GitHub does not accept', async () => {
    const rejected = () => jsonResponse({ message: 'Bad credentials' }, { status: 401 });
    const error = await validatePat(CLASSIC, {
      fetch: github({ graphql: rejected(), user: rejected() }),
    }).catch((e: unknown) => e);
    expect((error as GitHubError).kind).toBe('unauthorized');
  });

  it('rejects an answer without a viewer', async () => {
    for (const viewer of [null, { login: 'octocat' }, { login: 7, avatarUrl: 'x' }]) {
      const error = await validatePat(CLASSIC, { fetch: github({ viewer }) }).catch(
        (e: unknown) => e,
      );
      expect((error as GitHubError).kind).toBe('server');
    }
  });
});

describe('signInErrorMessage', () => {
  /** Runs a failing sign-in against a GitHub that echoes the token in its message. */
  async function messageFor(status: number, extra: Record<string, string> = {}) {
    const response = () =>
      jsonResponse({ message: `Nope for ${CLASSIC}` }, { status, headers: extra });
    const error = await validatePat(CLASSIC, {
      fetch: github({ graphql: response(), user: response() }),
    }).catch((e: unknown) => e);
    return signInErrorMessage(error);
  }

  it.each([
    [401, {}, /rejected this token/],
    [403, {}, /^GitHub refused this token: Nope for \[redacted\]$/],
    [403, { 'retry-after': '30' }, /rate limit/],
    [429, {}, /rate limit/],
    [404, {}, /^GitHub returned an error: /],
    [502, {}, /having trouble/],
  ])('HTTP %i %j', async (status, headers, expected) => {
    const message = await messageFor(status, headers);
    expect(message).toMatch(expected);
    expect(message).not.toContain(CLASSIC);
  });

  it('explains network failures', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new TypeError(`Failed to fetch ${CLASSIC}`);
    });
    const error = await validatePat(CLASSIC, { fetch }).catch((e: unknown) => e);
    const message = signInErrorMessage(error);
    expect(message).toMatch(/Could not reach GitHub/);
    expect(message).not.toContain(CLASSIC);
  });

  it('passes on GraphQL errors and our own validation messages', async () => {
    const error = await validatePat(CLASSIC, {
      fetch: github({
        graphql: jsonResponse({ errors: [graphqlError(undefined, 'Something odd')] }),
      }),
    }).catch((e: unknown) => e);
    expect(signInErrorMessage(error)).toBe('GitHub returned an error: Something odd');
    expect(signInErrorMessage(new GitHubError('validation', 'Paste a token to sign in.'))).toBe(
      'Paste a token to sign in.',
    );
  });

  it('has a fallback for anything else', () => {
    expect(signInErrorMessage(new Error(`boom ${CLASSIC}`))).toBe('Could not sign in. Try again.');
    expect(signInErrorMessage('x')).toBe('Could not sign in. Try again.');
  });
});
