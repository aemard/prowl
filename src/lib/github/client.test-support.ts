import { expect, vi } from 'vitest';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';

export const TOKEN = 'ghp_SecretTokenValue0123456789abcdefABCD';
export const API = 'https://api.github.com';

export function setup(...responses: (Response | Error)[]) {
  const fetch = vi.fn<FetchLike>(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch, client: createGitHubClient({ token: TOKEN, apiUrl: API, fetch }) };
}

export async function failure(promise: Promise<unknown>): Promise<GitHubError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(GitHubError);
  return error as GitHubError;
}

export const fields = (e: GitHubError) => [e.kind, e.status, e.resetAt, e.retryAfterSeconds];
