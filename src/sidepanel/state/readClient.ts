/**
 * The client of the panel's own reads: a card's detail, its conversations, the text the AI reads.
 * During the poll's rate-limit wait (`rateLimitWaitEnd`) it refuses them before they reach
 * GitHub, in the banner's words, so opening cards does not dig the budget deeper. Writes (a
 * review, a merge, a reply) keep `createGitHubClient`: a person stands behind each one, and
 * GitHub refuses one it cannot take with its own rate-limit error.
 */
import { env } from '../../lib/env';
import { createGitHubClient, type GitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { t } from '../../lib/i18n';
import { rateLimitWaitEnd } from '../../lib/time/backoff';
import { formatClock } from '../../lib/time/relative';
import { pollState } from './store';

function refuseDuringWait(): void {
  const state = pollState.value;
  const until = state ? rateLimitWaitEnd(state, Date.now()) : null;
  if (until !== null)
    throw new GitHubError('rate_limited', t('rateLimitedUntil', formatClock(until)));
}

export function readClient(token: string): GitHubClient {
  const client = createGitHubClient({ token, apiUrl: env.apiUrl });
  return {
    async graphql(query, variables, options) {
      refuseDuringWait();
      return client.graphql(query, variables, options);
    },
    async rest(method, path, body, options) {
      refuseDuringWait();
      return client.rest(method, path, body, options);
    },
    async restResponse(method, path, body, options) {
      refuseDuringWait();
      return client.restResponse(method, path, body, options);
    },
  };
}
