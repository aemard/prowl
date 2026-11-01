/**
 * Background polling: the `poll` alarm, single-flight polls, backoff and rate-limit waits.
 * Nothing that matters lives in memory (the worker can stop at any time): the schedule is
 * the alarm, everything else is `pollState` and `snapshot` in storage.
 */
import { carrySettledChecks, diffSnapshots } from '../lib/diff/diffSnapshots';
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { GitHubError } from '../lib/github/errors';
import { type FetchResult, fetchPullRequests } from '../lib/github/fetchPullRequests';
import { mapMergeState } from '../lib/github/mapPullRequest';
import { MERGE_STATE_QUERY, type MergeStateData } from '../lib/github/queries';
import { parseRateLimit } from '../lib/github/rateLimit';
import { discoverTeams, teamsDue } from '../lib/github/teams';
import type { AuthState, PollState, PrEvent, Snapshot } from '../lib/model';
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
import { isWaiting, LOW_RATE_LIMIT, rateLimitedUntil, retryAt } from '../lib/time/backoff';
import { clearBadge, updateBadge } from './badge';
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
  visibleCards.clear();
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
const consulted = new Map<string, number>();
const visibleCards = new Map<string, { ids: string[]; at: number }>();

/** Per-document hints expire if a panel closes without sending its cleanup message. */
export function setMergePriority(document: string, ids: string[]): void {
  if (ids.length === 0) visibleCards.delete(document);
  else visibleCards.set(document, { ids, at: Date.now() });
}

function mergePriority(): string[] {
  for (const [document, entry] of visibleCards) {
    if (Date.now() - entry.at > 60_000) visibleCards.delete(document);
  }
  return [
    ...new Set([...consulted.keys(), ...[...visibleCards.values()].flatMap(({ ids }) => ids)]),
  ];
}

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: legacy, tracked by the size ratchet — split when next touched
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: legacy, tracked by the size ratchet — split when next touched
async function runPoll(force: boolean, refreshTeams = false): Promise<PollResult | null> {
  const stored = await getItems(['auth', 'pollState', 'settings', 'teams', 'prLocal']);
  const { auth } = stored;
  if (!auth) {
    await chrome.alarms.clear(POLL_ALARM);
    return null;
  }
  const { mergePending: _pending, ...state } = stored.pollState ?? IDLE;
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
  let published = previous;
  const events: PrEvent[] = [];
  const publish = async (fetched: FetchResult, mergePending: string[]) => {
    if (!(await stillSignedIn(auth))) return;
    const next: Snapshot = {
      fetchedAt: new Date().toISOString(),
      viewer: auth.viewer,
      pullRequests: fetched.pullRequests,
      sections: fetched.sections,
      sectionErrors: fetched.sectionErrors,
      teamRequests: fetched.teamRequests,
      mergeStateAt: fetched.mergeStateAt,
      settledChecks: carrySettledChecks(previous, fetched.pullRequests),
    };
    const changes = previous ? diffSnapshots(published, next, auth.viewer.login) : [];
    await setItems({ snapshot: next, pollState: { ...attempt, mergePending, lastError: null } });
    // Clone the baseline: fetchPullRequests enriches its result in place after each batch.
    published = structuredClone(next);
    events.push(...changes);
    await updateBadge();
    await notifyEvents(changes, settings.notifications, normalizePrLocal(await getItem('prLocal')));
  };
  let rateLimit = state.rateLimit;
  // Discovered at sign-in (the panel drops the stored teams), when due, or on request.
  let { teams } = stored;
  const discover = refreshTeams || teamsDue(teams, auth.viewer.login, now);
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
    snapshot = {
      fetchedAt: new Date().toISOString(),
      viewer: auth.viewer,
      pullRequests: fetched.pullRequests,
      sections: fetched.sections,
      sectionErrors: fetched.sectionErrors,
      teamRequests: fetched.teamRequests,
      mergeStateAt: fetched.mergeStateAt,
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
    // Stored with the snapshot so a sign-out during the poll leaves no team list behind.
    teams: discover ? teams : undefined,
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
  // Every progressive publication has already updated the badge and delivered its events.
  return { snapshot, events };
}

/**
 * Refresh one consulted card, serialized with polls and other card reads. A recent read is
 * shared across panels/reopens; head and account checks drop results overtaken by changes.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: legacy, tracked by the size ratchet — split when next touched
export async function refreshMergeState(id: string, headSha: string): Promise<void> {
  const requestedAuth = await getItem('auth');
  if (!requestedAuth) return;
  consulted.set(id, (consulted.get(id) ?? 0) + 1);
  try {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: legacy, tracked by the size ratchet — split when next touched
    // biome-ignore lint/complexity/noExcessiveLinesPerFunction: legacy, tracked by the size ratchet — split when next touched
    await withLock('prowl:poll', async () => {
      const stored = await getItems(['auth', 'snapshot', 'pollState', 'settings']);
      const { auth, snapshot } = stored;
      const pr = snapshot?.pullRequests[id];
      const { mergePending: _pending, ...state } = stored.pollState ?? IDLE;
      // No poll can still be running under this lock, including after a worker restart.
      state.inFlight = false;
      const now = Date.now();
      if (
        auth?.token !== requestedAuth.token ||
        !snapshot ||
        !pr ||
        pr.state !== 'open' ||
        snapshot.viewer.login !== auth.viewer.login ||
        pr.headSha !== headSha ||
        state.lastError?.kind === 'unauthorized' ||
        isWaiting(state.nextAllowedAt, now)
      )
        return;
      const readAt = snapshot.mergeStateAt?.[id];
      if (
        readAt &&
        now - Date.parse(readAt) < 60_000 &&
        pr.mergeable !== 'unknown' &&
        pr.mergeStateStatus !== 'unknown'
      )
        return;
      const settings = normalizeSettings(stored.settings);
      try {
        await setItem('pollState', { ...state, mergePending: [id] });
        const client = createGitHubClient({ token: auth.token, apiUrl: env.apiUrl });
        const data = await client.graphql<MergeStateData>(
          MERGE_STATE_QUERY,
          { ids: [id] },
          { partial: true },
        );
        if (!(await stillSignedIn(auth))) return;
        const node = data.nodes?.[0];
        const latest = await getItem('snapshot');
        const latestPr = latest?.pullRequests[id];
        // A sign-out or a changed snapshot must never be replaced by this older read.
        if (
          !latest ||
          !latestPr ||
          latestPr.state !== 'open' ||
          latest.viewer.login !== auth.viewer.login ||
          latestPr.headSha !== headSha
        )
          return;
        if (node && node.id === id) {
          const next: Snapshot = {
            ...latest,
            pullRequests: {
              ...latest.pullRequests,
              [id]: { ...latestPr, ...mapMergeState(node) },
            },
            mergeStateAt: { ...latest.mergeStateAt, [id]: new Date().toISOString() },
          };
          await setItem('snapshot', next);
          await updateBadge();
          await notifyEvents(
            diffSnapshots(latest, next, auth.viewer.login),
            settings.notifications,
            normalizePrLocal(await getItem('prLocal')),
          );
        }
        if (!(await stillSignedIn(auth))) return;
        const rateLimit = parseRateLimit(data.rateLimit) ?? state.rateLimit;
        await setItem('pollState', {
          ...state,
          rateLimit,
          nextAllowedAt:
            rateLimit && rateLimit.remaining < LOW_RATE_LIMIT
              ? iso(rateLimitedUntil(now, { resetAt: rateLimit.resetAt, retryAfterSeconds: null }))
              : state.nextAllowedAt,
        });
      } catch (error) {
        if (!(await stillSignedIn(auth))) return;
        const failure = error instanceof GitHubError ? error : unexpected(error);
        if (failure.kind === 'unauthorized') await chrome.alarms.clear(POLL_ALARM);
        const failures = state.consecutiveFailures + 1;
        await setItem('pollState', {
          ...state,
          inFlight: false,
          consecutiveFailures: failures,
          nextAllowedAt: iso(retryAt(now, failure, settings.pollIntervalMinutes, failures)),
          lastError: { kind: failure.kind, message: failure.message },
        });
      } finally {
        // Head changes, missing nodes and failures must also remove the card's indicator.
        if (await stillSignedIn(auth)) {
          const latest = await getItem('pollState');
          if (latest?.mergePending) {
            const { mergePending: _pending, ...idle } = latest;
            await setItem('pollState', idle);
          }
        }
      }
    });
  } finally {
    const remaining = (consulted.get(id) ?? 1) - 1;
    if (remaining) consulted.set(id, remaining);
    else consulted.delete(id);
  }
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
