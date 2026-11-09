/** State and error handling shared by scheduled polls and consulted-card refreshes. */
import { GitHubError } from '../lib/github/errors';
import { t } from '../lib/i18n';
import type { PollState } from '../lib/model';
import { setItem } from '../lib/storage/storage';
import { retryAt } from '../lib/time/backoff';

export const POLL_ALARM = 'poll';

export const IDLE: PollState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
  rateLimit: null,
  lastError: null,
  inFlight: false,
};

export const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * Stores a failed poll or card read and when to try again. Anything but a `GitHubError` is not a
 * GitHub failure: a bug, or data Prowl could not handle. Details go to the console.
 */
export async function recordPollFailure(
  error: unknown,
  state: PollState,
  now: number,
  interval: number,
): Promise<void> {
  if (!(error instanceof GitHubError)) console.error('Prowl: poll failed', error);
  const failure =
    error instanceof GitHubError
      ? error
      : new GitHubError('server', t('somethingWentWrongWhileRefreshing'));
  const failures = state.consecutiveFailures + 1;
  if (failure.kind === 'unauthorized') await chrome.alarms.clear(POLL_ALARM);
  await setItem('pollState', {
    ...state,
    inFlight: false,
    consecutiveFailures: failures,
    nextAllowedAt: iso(retryAt(now, failure, interval, failures)),
    lastError: { kind: failure.kind, message: failure.message },
  });
}
