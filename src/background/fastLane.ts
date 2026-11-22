/**
 * Near-real-time news between polls, from the `inbox` alarm (every minute). It only asks for
 * polls; whether one runs is the cadence policy's call (`pollVerdict`), like every other trigger.
 * - a conditional read of the notifications inbox (`checkInbox`), no more often than GitHub's
 *   `X-Poll-Interval`; a pull request thread updated since the last check asks for an `inbox`
 *   poll. Off for tokens that cannot read the inbox (fine-grained ones, or a 403/404) for the
 *   browser session.
 * - while CI runs on one of the viewer's own listed pull requests that changed in the last hour
 *   (`ciWatched`), a `ci` poll every 2 minutes, so a red or green build shows up quickly
 *   (third-party CI never reaches the inbox).
 * Also a `focus` poll when Chrome comes back to the foreground.
 */
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { GitHubError } from '../lib/github/errors';
import { checkInbox } from '../lib/github/notifications';
import type { AuthState, PollState } from '../lib/model';
import { withSignedIn } from '../lib/storage/session';
import { normalizeSettings } from '../lib/storage/settings';
import { getItems, withLock } from '../lib/storage/storage';
import { isWaiting, rateLimitedUntil } from '../lib/time/backoff';
import { ciWatched, pollVerdict } from '../lib/time/cadence';
import { poll } from './poller';
import { clearAlarms, IDLE, iso, recordPollFailure } from './pollState';

const STATE = 'inbox';
const MINUTE = 60_000;

/**
 * `chrome.storage.session` key `inbox`: GitHub's `Last-Modified` of the last answer, when the
 * next check may run (`X-Poll-Interval` after the last one), and whether the lane is off.
 */
type InboxState = { lastModified: string | null; nextAt?: string; off?: true };

interface LaneContext {
  auth: AuthState;
  state: PollState;
  interval: number;
  /** When the alarm was due: `X-Poll-Interval` counts from there, so alarm jitter never skips. */
  at: number;
}

async function inboxChanged({ auth, state, interval, at }: LaneContext): Promise<boolean> {
  if (auth.tokenType === 'fine_grained') return false;
  const stored = (await chrome.storage.session.get<{ [STATE]?: InboxState }>(STATE))[STATE];
  // `isWaiting` ignores a wait over an hour long: the clock went back since it was stored.
  if (stored?.off || isWaiting(stored?.nextAt ?? null, at)) return false;
  try {
    const client = createGitHubClient({ token: auth.token, apiUrl: env.apiUrl });
    const { changed, lastModified, pollSeconds } = await checkInbox(
      client,
      stored?.lastModified ?? null,
    );
    await chrome.storage.session.set({
      [STATE]: { lastModified, nextAt: iso(at + pollSeconds * 1000) },
    });
    return changed;
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    await laneFailed(error, { auth, state, interval, at }, stored?.lastModified ?? null);
    return false;
  }
}

/**
 * The inbox check failed. A token without inbox access stops asking for this browser session. A
 * rate limit backs off only the lane: `/notifications` spends the REST budget, polls the GraphQL
 * one (separate pools). A rejected token holds every poll, as if a poll had met it.
 */
async function laneFailed(error: GitHubError, lane: LaneContext, lastModified: string | null) {
  const { auth, state, interval } = lane;
  if (['forbidden', 'not_found'].includes(error.kind))
    await chrome.storage.session.set({ [STATE]: { lastModified: null, off: true } });
  if (error.kind === 'rate_limited') {
    const now = Date.now();
    const until = rateLimitedUntil(now, error) ?? now + MINUTE;
    await chrome.storage.session.set({ [STATE]: { lastModified, nextAt: iso(until) } });
  }
  if (error.kind === 'unauthorized')
    await withLock('prowl:poll', async () => {
      await withSignedIn(auth, () => recordPollFailure(error, state, Date.now(), interval));
    });
}

/** Runs on the `inbox` alarm (`at`: its scheduled time). Never rejects. */
export async function checkFastLane(at = Date.now()): Promise<void> {
  try {
    const { auth, snapshot, pollState, settings } = await getItems([
      'auth',
      'snapshot',
      'pollState',
      'settings',
    ]);
    if (!auth) return;
    const state = pollState ?? IDLE;
    const interval = normalizeSettings(settings).pollIntervalMinutes;
    // Ask GitHub nothing while no poll may run; a rejected token also stops this alarm (it
    // outlived the poll alarm on versions that cleared only that one).
    const verdict = pollVerdict('inbox', state, null, interval, Date.now());
    if (!verdict.run) {
      if (verdict.why === 'unauthorized') await withSignedIn(auth, clearAlarms);
      return;
    }
    if (await inboxChanged({ auth, state, interval, at })) await poll({ reason: 'inbox' });
    else if (ciWatched(snapshot, Date.now())) await poll({ reason: 'ci' });
  } catch (error) {
    console.error('Prowl: the fast lane failed', error);
  }
}

/** A Chrome window got focus: a `focus` poll (it runs when the list is older than the interval). */
export async function onChromeFocused(windowId: number): Promise<void> {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) await poll({ reason: 'focus' });
}
