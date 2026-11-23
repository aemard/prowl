/**
 * Background polling: single-flight polls, each asked for a `PollReason` that the cadence policy
 * (`pollVerdict`) admits or skips. Nothing that matters lives in memory (the worker can stop at
 * any time): the schedule is the alarms, everything else is `pollState` and `snapshot` in storage.
 */
import { carryCiOutcomes } from '../lib/diff/checkTransitions';
import { carrySettledChecks, diffSnapshots } from '../lib/diff/diffSnapshots';
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { type FetchResult, fetchPullRequests } from '../lib/github/fetchPullRequests';
import { discoverTeams, teamsDue } from '../lib/github/teams';
import { setLanguage } from '../lib/i18n';
import type {
  AuthState,
  PollReason,
  PollState,
  PrEvent,
  RateLimit,
  Snapshot,
  TeamsState,
} from '../lib/model';
import {
  baselineSeenFacts,
  forgetSeenFacts,
  normalizePrLocal,
  pruneExpired,
  updatePrLocal,
} from '../lib/storage/prLocal';
import { SESSION_LOCK, withSignedIn } from '../lib/storage/session';
import { normalizeSettings } from '../lib/storage/settings';
import {
  getItem,
  getItems,
  removeItems,
  setItem,
  setItems,
  withLock,
} from '../lib/storage/storage';
import { LOW_RATE_LIMIT, rateLimitedUntil } from '../lib/time/backoff';
import { isExplicit, isTrailing, pollVerdict } from '../lib/time/cadence';
import { clearBadge, updateBadge } from './badge';
import { clearMergePriority, mergePriority } from './mergeState';
import { forgetNotified, notifyEvents } from './notifier';
import {
  clearAlarms,
  IDLE,
  INBOX_STATE,
  iso,
  recordPollFailure,
  scheduleAlarms,
} from './pollState';

export { refreshMergeState, setMergePriority } from './mergeState';

/** What a poll that ran produced: the stored snapshot and the changes since the previous one. */
export interface PollResult {
  snapshot: Snapshot;
  events: PrEvent[];
}

/**
 * After sign-out: nothing scheduled, no poll state, no badge, no notifications. Removing
 * `auth` and `snapshot` is the panel's job.
 */
export async function clearSignedOut(): Promise<void> {
  await withLock(SESSION_LOCK, async () => {
    if (await getItem('auth')) return;
    await forgetSeenFacts();
    clearMergePriority();
    const shown = await chrome.notifications.getAll();
    await Promise.all([
      clearAlarms(),
      removeItems('pollState'),
      clearBadge(),
      forgetNotified(),
      chrome.storage.session.remove(INBOX_STATE),
      ...Object.keys(shown).map((id) => chrome.notifications.clear(id)),
    ]);
  });
}

let current: Promise<PollResult | null> | null = null;
let queued: Promise<PollResult | null> | null = null;
let queuedReason: PollReason | null = null;
let queuedTeams = false;

/** The reason a shared trailing poll runs for: an explicit one wins, then news from the inbox. */
const stronger = (a: PollReason | null, b: PollReason): PollReason =>
  a === null || isExplicit(b) || (!isExplicit(a) && b === 'inbox') ? b : a;

/**
 * Polls GitHub when signed in and the cadence policy admits `reason` (see `pollVerdict`: a
 * rejected token, a backoff, a rate-limit wait or a list fresh enough for that reason skip it);
 * `refreshTeams` discovers the viewer's teams again even when they are not due. Ordinary reasons
 * share the poll in flight; trailing ones (`isTrailing`: inbox news, a change) and team refreshes
 * share one poll after it, which reads the latest configuration. Resolves to null when the poll
 * was skipped, failed (see `pollState.lastError`) or was dropped by a sign-out; never rejects.
 */
export function poll({
  reason = 'schedule',
  refreshTeams = false,
}: {
  reason?: PollReason;
  refreshTeams?: boolean;
} = {}): Promise<PollResult | null> {
  if (current && (isTrailing(reason) || refreshTeams)) {
    queuedReason = stronger(queuedReason, reason);
    queuedTeams ||= refreshTeams;
    queued ??= current.then(() => {
      const next = { reason: queuedReason ?? reason, refreshTeams: queuedTeams };
      queuedReason = null;
      queuedTeams = false;
      queued = null;
      return poll(next);
    });
    return queued;
  }
  current ??= withLock('prowl:poll', () => runPoll(reason, refreshTeams))
    .catch((error: unknown) => {
      console.error('Prowl: poll failed', error);
      return null;
    })
    .finally(() => {
      current = null;
    });
  return current;
}

async function preparePoll(reason: PollReason) {
  const stored = await getItems(['auth', 'pollState', 'settings', 'teams', 'prLocal', 'snapshot']);
  const { auth } = stored;
  if (!auth) {
    await withLock(SESSION_LOCK, async () => {
      if (!(await getItem('auth'))) await clearAlarms();
    });
    return null;
  }
  const { mergePending: _pending, ...state } = stored.pollState ?? IDLE;
  const settings = normalizeSettings(stored.settings);
  await setLanguage(settings.language);
  const now = Date.now();
  // Another account's snapshot is no baseline, and its PRs are not this account's business.
  const previous = stored.snapshot?.viewer.login === auth.viewer.login ? stored.snapshot : null;
  const verdict = pollVerdict(
    reason,
    state,
    previous?.fetchedAt ?? null,
    settings.pollIntervalMinutes,
    now,
  );
  // A rejected token cleared the alarms: only an explicit poll (re-auth, Refresh) tries again.
  if (!verdict.run && verdict.why === 'unauthorized') return null;
  const active = await withSignedIn(auth, async () => {
    await scheduleAlarms(settings.pollIntervalMinutes);
    return true;
  });
  if (!active) return preparePoll(reason);
  if (!verdict.run) {
    // In flight here means a worker stopped mid-poll: no other poll runs beside this one.
    if (state.inFlight)
      await withSignedIn(auth, () => setItem('pollState', { ...state, inFlight: false }));
    return null;
  }
  const attempt: PollState = { ...state, lastAttemptAt: iso(now), inFlight: true };
  if (
    !(await withSignedIn(auth, async () => {
      await setItem('pollState', attempt);
      return true;
    }))
  )
    return preparePoll(reason);
  return { stored, auth, state, settings, now, attempt, previous };
}

type PollAttempt = NonNullable<Awaited<ReturnType<typeof preparePoll>>>;

function snapshotOf(auth: AuthState, previous: Snapshot | null, fetched: FetchResult): Snapshot {
  return {
    fetchedAt: new Date().toISOString(),
    viewer: auth.viewer,
    pullRequests: fetched.pullRequests,
    sections: fetched.sections,
    sectionCoverage: fetched.sectionCoverage,
    sectionScopes: fetched.sectionScopes,
    sectionsPending: fetched.sectionsPending,
    sectionErrors: fetched.sectionErrors,
    teamRequests: fetched.teamRequests,
    mergeStateAt: fetched.mergeStateAt,
    mergeStateDue: fetched.mergeStateDue,
    ciOutcomes: carryCiOutcomes(previous, fetched.pullRequests),
    settledChecks: carrySettledChecks(previous, fetched.pullRequests),
  };
}

function progressPublisher({ auth, previous, attempt, settings }: PollAttempt) {
  let published = previous;
  const events: PrEvent[] = [];
  const publish = async (fetched: FetchResult, mergePending: string[]) => {
    await withSignedIn(auth, async () => {
      if (previous) await updatePrLocal((state) => baselineSeenFacts(state, previous.pullRequests));
      const next = snapshotOf(auth, previous, fetched);
      const changes = previous ? diffSnapshots(published, next, auth.viewer.login) : [];
      await setItems({ snapshot: next, pollState: { ...attempt, mergePending, lastError: null } });
      // Clone the baseline: fetchPullRequests enriches its result in place after each batch.
      published = structuredClone(next);
      events.push(...changes);
      await updateBadge();
      await notifyEvents(
        changes,
        settings.notifications,
        normalizePrLocal(await getItem('prLocal')),
      );
    });
  };
  return { events, publish };
}

async function runPoll(reason: PollReason, refreshTeams = false): Promise<PollResult | null> {
  const prepared = await preparePoll(reason);
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
    const handled = await withSignedIn(auth, async () => {
      await recordPollFailure(error, attempt, now, settings.pollIntervalMinutes);
      return true;
    });
    return handled ? null : restartOrStop(reason);
  }
  const finished = await withSignedIn(auth, async () => {
    await finishPoll(prepared, snapshot, discover ? teams : undefined, rateLimit);
    return true;
  });
  if (!finished) return restartOrStop(reason);
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
  // Absence from a bounded search is not closure. Only discard choices for confirmed closed
  // PRs; snoozes expire by date even if a PR is outside the current search scope.
  const closed = new Set(
    Object.values(snapshot.pullRequests)
      .filter((pr) => pr.state !== 'open')
      .map((pr) => pr.id),
  );
  await updatePrLocal((state) =>
    pruneExpired(
      state,
      Date.now(),
      [
        ...new Set([
          ...Object.keys(state.muted),
          ...Object.keys(state.snoozed),
          ...Object.keys(state.seen),
          ...Object.keys(state.seenFacts ?? {}),
        ]),
      ].filter((id) => !closed.has(id)),
    ),
  );
}

/** The poll's account is gone: start over for whoever signed in, or clean up after sign-out. */
async function restartOrStop(reason: PollReason): Promise<PollResult | null> {
  if (await getItem('auth')) return runPoll(reason);
  await clearSignedOut();
  return null;
}
