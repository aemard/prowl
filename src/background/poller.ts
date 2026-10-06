/**
 * Background polling: the `poll` alarm, single-flight polls, backoff and rate-limit waits.
 * Nothing that matters lives in memory (the worker can stop at any time): the schedule is
 * the alarm, everything else is `pollState` and `snapshot` in storage.
 */
import { carrySettledChecks, diffSnapshots } from '../lib/diff/diffSnapshots';
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { GitHubError } from '../lib/github/errors';
import { fetchPullRequests } from '../lib/github/fetchPullRequests';
import type { AuthState, PollState, PrEvent, Snapshot } from '../lib/model';
import { pruneExpired, updatePrLocal } from '../lib/storage/prLocal';
import { normalizeSettings } from '../lib/storage/settings';
import { getItem, getItems, removeItems, setItem, setItems } from '../lib/storage/storage';
import { isWaiting, LOW_RATE_LIMIT, rateLimitedUntil, retryAt } from '../lib/time/backoff';
import { forgetNotified, notifyEvents } from './notifier';

export const POLL_ALARM = 'poll';

/** What a poll that ran produced: the stored snapshot and the changes since the previous one. */
export interface PollResult {
  snapshot: Snapshot;
  events: PrEvent[];
}

const IDLE: PollState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
  rateLimit: null,
  lastError: null,
  inFlight: false,
};

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** (Re)creates the alarm unless it already has this period; `ifScheduled`: only change one. */
export async function scheduleAlarm(minutes: number, ifScheduled = false): Promise<void> {
  const alarm = await chrome.alarms.get(POLL_ALARM);
  if (alarm ? alarm.periodInMinutes === minutes : ifScheduled) return;
  await chrome.alarms.create(POLL_ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
}

/**
 * After sign-out: nothing scheduled, no poll state, no badge, no notifications. Removing
 * `auth` and `snapshot` is the panel's job.
 */
export async function clearSignedOut(): Promise<void> {
  const shown = await chrome.notifications.getAll();
  await Promise.all([
    chrome.alarms.clear(POLL_ALARM),
    removeItems('pollState'),
    chrome.action.setBadgeText({ text: '' }),
    forgetNotified(),
    ...Object.keys(shown).map((id) => chrome.notifications.clear(id)),
  ]);
}

let current: Promise<PollResult | null> | null = null;

/**
 * Polls GitHub unless signed out, stopped by a rejected token, or waiting (backoff, rate
 * limit). `force` (a user action) skips the backoff and retries a rejected token, never a
 * rate-limit wait. Concurrent calls share the poll in flight. Resolves to null when the poll
 * was skipped, failed (see `pollState.lastError`) or was dropped by a sign-out; never rejects.
 */
export function poll({ force = false }: { force?: boolean } = {}): Promise<PollResult | null> {
  current ??= runPoll(force)
    .catch((error: unknown) => {
      console.error('Prowl: poll failed', error);
      return null;
    })
    .finally(() => {
      current = null;
    });
  return current;
}

async function runPoll(force: boolean): Promise<PollResult | null> {
  const stored = await getItems(['auth', 'pollState', 'settings']);
  const { auth } = stored;
  if (!auth) {
    await chrome.alarms.clear(POLL_ALARM);
    return null;
  }
  const state = stored.pollState ?? IDLE;
  const { pollIntervalMinutes: interval, ...settings } = normalizeSettings(stored.settings);
  const now = Date.now();
  // A rejected token cleared the alarm: only a forced poll (re-auth, refresh) tries again.
  if (state.lastError?.kind === 'unauthorized' && !force) return null;
  await scheduleAlarm(interval);
  // A wait after another error is a backoff; any other one (after a rate limit, or a success
  // that left a low budget) is for the rate limit, which even a forced poll respects.
  const backoff = state.lastError !== null && state.lastError.kind !== 'rate_limited';
  if (isWaiting(state.nextAllowedAt, now) && !(force && backoff)) {
    // In flight here means a worker stopped mid-poll: no other poll runs beside this one.
    if (state.inFlight) await setItem('pollState', { ...state, inFlight: false });
    return null;
  }

  const attempt: PollState = { ...state, lastAttemptAt: iso(now), inFlight: true };
  await setItem('pollState', attempt);
  const stale = await getItem('snapshot');
  // Another account's snapshot is no baseline, and its PRs are not this account's business.
  const previous = stale?.viewer.login === auth.viewer.login ? stale : null;

  let snapshot: Snapshot;
  let sectionErrors: Record<string, string>;
  let rateLimit = state.rateLimit;
  try {
    const client = createGitHubClient({ token: auth.token, apiUrl: env.apiUrl });
    const fetched = await fetchPullRequests(client, settings, previous);
    sectionErrors = fetched.sectionErrors;
    rateLimit = fetched.rateLimit ?? rateLimit;
    snapshot = {
      fetchedAt: new Date().toISOString(),
      viewer: auth.viewer,
      pullRequests: fetched.pullRequests,
      sections: fetched.sections,
      sectionErrors,
      settledChecks: carrySettledChecks(previous, fetched.pullRequests),
    };
  } catch (error) {
    if (!(await stillSignedIn(auth))) return restartOrStop(force);
    const failure = error instanceof GitHubError ? error : unexpected(error);
    const failures = state.consecutiveFailures + 1;
    if (failure.kind === 'unauthorized') await chrome.alarms.clear(POLL_ALARM);
    await setItem('pollState', {
      ...attempt,
      inFlight: false,
      consecutiveFailures: failures,
      nextAllowedAt: iso(retryAt(now, failure, interval, failures)),
      lastError: { kind: failure.kind, message: failure.message },
    });
    return null;
  }

  // ponytail: a sign-out between this check and the write below (a few ms) leaves the result
  // stored; closing that window needs a lock that the panel's sign-out would share.
  if (!(await stillSignedIn(auth))) return restartOrStop(force);
  const until =
    rateLimit && rateLimit.remaining < LOW_RATE_LIMIT
      ? rateLimitedUntil(now, { resetAt: rateLimit.resetAt, retryAfterSeconds: null })
      : null;
  await setItems({
    snapshot,
    pollState: {
      ...attempt,
      lastSuccessAt: snapshot.fetchedAt,
      nextAllowedAt: iso(until),
      consecutiveFailures: 0,
      rateLimit,
      lastError: null,
      inFlight: false,
    },
  });
  // A section that failed to load hides its PRs this time: keep their snoozes and mutes.
  const known =
    Object.keys(sectionErrors).length > 0 ? undefined : Object.keys(snapshot.pullRequests);
  const local = await updatePrLocal((state) => pruneExpired(state, Date.now(), known));
  const events = diffSnapshots(previous, snapshot, auth.viewer.login);
  // Notifications and the badge (US-009) hook in here: once per poll that ran, while every
  // caller sharing the poll gets the same result.
  await notifyEvents(events, settings.notifications, local);
  return { snapshot, events };
}

/** The token the poll started with is still the stored one. */
async function stillSignedIn(auth: AuthState): Promise<boolean> {
  return (await getItem('auth'))?.token === auth.token;
}

/** The poll's account is gone: start over for whoever signed in, or clean up after sign-out. */
async function restartOrStop(force: boolean): Promise<PollResult | null> {
  if (await getItem('auth')) return runPoll(force);
  await clearSignedOut();
  return null;
}

/** Not a GitHub failure: a bug, or data Prowl could not handle. Details go to the console. */
function unexpected(error: unknown): GitHubError {
  console.error('Prowl: poll failed', error);
  return new GitHubError('server', 'Something went wrong while refreshing.');
}
