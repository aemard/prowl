/**
 * Background polling: the `poll` alarm, single-flight polls, backoff and rate-limit waits.
 * Nothing that matters lives in memory (the worker can stop at any time): the schedule is
 * the alarm, everything else is `pollState` and `snapshot` in storage.
 */
import { carrySettledChecks, diffSnapshots } from '../lib/diff/diffSnapshots';
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { type FetchResult, fetchPullRequests } from '../lib/github/fetchPullRequests';
import { discoverTeams, teamsDue } from '../lib/github/teams';
import type { AuthState, PollState, PrEvent, RateLimit, Snapshot, TeamsState } from '../lib/model';
import { normalizePrLocal, pruneExpired, updatePrLocal } from '../lib/storage/prLocal';
import { normalizeSettings } from '../lib/storage/settings';
import {
  getItem,
  getItems,
  removeItems,
  setItem,
  setItems,
  withLock,
} from '../lib/storage/storage';
import { isWaiting, LOW_RATE_LIMIT, rateLimitedUntil } from '../lib/time/backoff';
import { clearBadge, updateBadge } from './badge';
import { clearMergePriority, mergePriority } from './mergeState';
import { forgetNotified, notifyEvents } from './notifier';
import { IDLE, iso, POLL_ALARM, recordPollFailure, stillSignedIn } from './pollState';

export { refreshMergeState, setMergePriority } from './mergeState';
export { POLL_ALARM } from './pollState';

/** What a poll that ran produced: the stored snapshot and the changes since the previous one. */
export interface PollResult {
  snapshot: Snapshot;
  events: PrEvent[];
}

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
  clearMergePriority();
  const shown = await chrome.notifications.getAll();
  await Promise.all([
    chrome.alarms.clear(POLL_ALARM),
    removeItems('pollState'),
    clearBadge(),
    forgetNotified(),
    ...Object.keys(shown).map((id) => chrome.notifications.clear(id)),
  ]);
}

let current: Promise<PollResult | null> | null = null;

/**
 * Polls GitHub unless signed out, stopped by a rejected token, or waiting (backoff, rate
 * limit). `force` (a user action) skips the backoff and retries a rejected token, never a
 * rate-limit wait; `refreshTeams` discovers the viewer's teams again even when they are not
 * due. Concurrent calls share the poll in flight, except a team refresh, which waits for it
 * and runs its own. Resolves to null when the poll was skipped, failed (see
 * `pollState.lastError`) or was dropped by a sign-out; never rejects.
 */
export function poll({
  force = false,
  refreshTeams = false,
}: {
  force?: boolean;
  refreshTeams?: boolean;
} = {}): Promise<PollResult | null> {
  // The poll in flight may have read the teams before this request came in.
  if (refreshTeams && current) return current.then(() => poll({ force, refreshTeams }));
  current ??= withLock('prowl:poll', () => runPoll(force, refreshTeams))
    .catch((error: unknown) => {
      console.error('Prowl: poll failed', error);
      return null;
    })
    .finally(() => {
      current = null;
    });
  return current;
}

async function preparePoll(force: boolean) {
  const stored = await getItems(['auth', 'pollState', 'settings', 'teams', 'prLocal']);
  const { auth } = stored;
  if (!auth) {
    await chrome.alarms.clear(POLL_ALARM);
    return null;
  }
  const { mergePending: _pending, ...state } = stored.pollState ?? IDLE;
  const settings = normalizeSettings(stored.settings);
  const now = Date.now();
  // A rejected token cleared the alarm: only a forced poll (re-auth, refresh) tries again.
  if (state.lastError?.kind === 'unauthorized' && !force) return null;
  await scheduleAlarm(settings.pollIntervalMinutes);
  // A forced poll skips backoff, but even a forced poll must respect a rate-limit wait.
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
  return { stored, auth, state, settings, now, attempt, previous };
}

type PollAttempt = NonNullable<Awaited<ReturnType<typeof preparePoll>>>;

function snapshotOf(auth: AuthState, previous: Snapshot | null, fetched: FetchResult): Snapshot {
  return {
    fetchedAt: new Date().toISOString(),
    viewer: auth.viewer,
    pullRequests: fetched.pullRequests,
    sections: fetched.sections,
    sectionErrors: fetched.sectionErrors,
    teamRequests: fetched.teamRequests,
    mergeStateAt: fetched.mergeStateAt,
    settledChecks: carrySettledChecks(previous, fetched.pullRequests),
  };
}

function progressPublisher({ auth, previous, attempt, settings }: PollAttempt) {
  let published = previous;
  const events: PrEvent[] = [];
  const publish = async (fetched: FetchResult, mergePending: string[]) => {
    if (!(await stillSignedIn(auth))) return;
    const next = snapshotOf(auth, previous, fetched);
    const changes = previous ? diffSnapshots(published, next, auth.viewer.login) : [];
    await setItems({ snapshot: next, pollState: { ...attempt, mergePending, lastError: null } });
    // Clone the baseline: fetchPullRequests enriches its result in place after each batch.
    published = structuredClone(next);
    events.push(...changes);
    await updateBadge();
    await notifyEvents(changes, settings.notifications, normalizePrLocal(await getItem('prLocal')));
  };
  return { events, publish };
}

async function runPoll(force: boolean, refreshTeams = false): Promise<PollResult | null> {
  const prepared = await preparePoll(force);
  if (!prepared) return null;
  const { stored, auth, state, settings, now, attempt, previous } = prepared;
  const { events, publish } = progressPublisher(prepared);
  let rateLimit = state.rateLimit;
  let { teams } = stored;
  // Discovered at sign-in (the panel drops the stored teams), when due, or on request.
  const discover = refreshTeams || teamsDue(teams, auth.viewer.login, now);
  let snapshot: Snapshot;
  try {
    const client = createGitHubClient({ token: auth.token, apiUrl: env.apiUrl });
    if (discover) teams = await discoverTeams(client, auth, teams, now);
    const fetched = await fetchPullRequests(
      client,
      settings,
      previous,
      teams,
      normalizePrLocal(stored.prLocal),
      publish,
      mergePriority,
    );
    rateLimit = fetched.rateLimit ?? rateLimit;
    snapshot = snapshotOf(auth, previous, fetched);
  } catch (error) {
    if (!(await stillSignedIn(auth))) return restartOrStop(force);
    await recordPollFailure(error, attempt, now, settings.pollIntervalMinutes);
    return null;
  }
  // ponytail: a sign-out between this check and the write below (a few ms) leaves the result
  // stored; closing that window needs a lock that the panel's sign-out would share.
  if (!(await stillSignedIn(auth))) return restartOrStop(force);
  await finishPoll(prepared, snapshot, discover ? teams : undefined, rateLimit);
  // Every progressive publication has already updated the badge and delivered its events.
  return { snapshot, events };
}

async function finishPoll(
  { attempt, now }: PollAttempt,
  snapshot: Snapshot,
  teams: TeamsState | undefined,
  rateLimit: RateLimit | null,
): Promise<void> {
  const until =
    rateLimit && rateLimit.remaining < LOW_RATE_LIMIT
      ? rateLimitedUntil(now, { resetAt: rateLimit.resetAt, retryAfterSeconds: null })
      : null;
  await setItems({
    snapshot,
    // Stored with the snapshot so a sign-out during the poll leaves no team list behind.
    teams,
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
    Object.keys(snapshot.sectionErrors ?? {}).length > 0
      ? undefined
      : Object.keys(snapshot.pullRequests);
  await updatePrLocal((state) => pruneExpired(state, Date.now(), known));
}

/** The poll's account is gone: start over for whoever signed in, or clean up after sign-out. */
async function restartOrStop(force: boolean): Promise<PollResult | null> {
  if (await getItem('auth')) return runPoll(force);
  await clearSignedOut();
  return null;
}
