/**
 * The worker's alarms, and the state and error handling shared by polls, the fast lane and
 * consulted-card refreshes.
 */
import { GitHubError } from '../lib/github/errors';
import { t } from '../lib/i18n';
import type { PollState } from '../lib/model';
import { setItem } from '../lib/storage/storage';
import { retryAt } from '../lib/time/backoff';

export const POLL_ALARM = 'poll';
/** The fast lane's minute alarm (fastLane.ts): the inbox check and the CI watch. */
export const INBOX_ALARM = 'inbox';
/** The fast lane's `chrome.storage.session` key (fastLane.ts), which sign-out removes. */
export const INBOX_STATE = 'inbox';

/**
 * Makes sure both alarms exist while polling runs: the poll alarm with this period (recreated
 * only when it differs, so its next run keeps its place), the inbox alarm every minute.
 * Idempotent, and it repairs an install where only one of them survived (an upgrade from a
 * version without the inbox alarm, a browser restart that dropped one). `ifScheduled`: only
 * when polling runs already (a settings change while signed out or stopped schedules nothing).
 */
export async function scheduleAlarms(minutes: number, ifScheduled = false): Promise<void> {
  const [poll, inbox] = await Promise.all([
    chrome.alarms.get(POLL_ALARM),
    chrome.alarms.get(INBOX_ALARM),
  ]);
  if (!poll && ifScheduled) return;
  await Promise.all([
    poll?.periodInMinutes === minutes
      ? undefined
      : chrome.alarms.create(POLL_ALARM, { delayInMinutes: minutes, periodInMinutes: minutes }),
    inbox ? undefined : chrome.alarms.create(INBOX_ALARM, { periodInMinutes: 1 }),
  ]);
}

/** Polling stops (sign-out, rejected token): nothing may wake the worker to call GitHub. */
export async function clearAlarms(): Promise<void> {
  await Promise.all([chrome.alarms.clear(POLL_ALARM), chrome.alarms.clear(INBOX_ALARM)]);
}

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
  if (failure.kind === 'unauthorized') await clearAlarms();
  await setItem('pollState', {
    ...state,
    inFlight: false,
    consecutiveFailures: failures,
    nextAllowedAt: iso(retryAt(now, failure, interval, failures)),
    lastError: { kind: failure.kind, message: failure.message },
  });
}
