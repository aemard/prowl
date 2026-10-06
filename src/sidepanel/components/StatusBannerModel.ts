/** What the status banner says about the last poll. Pure: the component only renders it. */
import type { PollState } from '../../lib/model';
import { isWaiting, LOW_RATE_LIMIT } from '../../lib/time/backoff';
import { formatRelativeTime } from '../../lib/time/relative';

export type BannerKind = 'unauthorized' | 'rate_limited' | 'offline' | 'error' | 'stale';

export interface Banner {
  kind: BannerKind;
  tone: 'danger' | 'warning';
  /** What happened and, where it helps, when Prowl tries again. */
  title: string;
  /** Why, in GitHub's words, or what Prowl does about it. Empty when the title says it all. */
  detail: string;
  /** How old the list on screen is; empty without a snapshot or when it is under a minute old. */
  age: string;
  /** `reauthenticate` opens the sign-in screen, `retry` forces a poll; null: nothing to do. */
  action: { type: 'reauthenticate' | 'retry'; label: string } | null;
}

const MINUTE = 60_000;
/** With no error to explain it, a snapshot older than this many poll intervals is stale. */
const STALE_INTERVALS = 5;
const STALE_MIN_MS = 10 * MINUTE;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const RETRY = { type: 'retry', label: 'Retry' } as const;

/**
 * The banner for the stored poll state, or null when all is well. `fetchedAt` is the snapshot's:
 * an error never hides the data on screen, the banner only says how old it is.
 */
export function describeStatus(
  poll: PollState | undefined,
  fetchedAt: string | undefined,
  intervalMinutes: number,
  now: number,
): Banner | null {
  if (!poll) return null;
  // The header already says "just now"; the banner names an age worth noticing.
  const age =
    fetchedAt && now - Date.parse(fetchedAt) >= MINUTE
      ? `Last updated ${formatRelativeTime(fetchedAt, now)}.`
      : '';
  const waiting = isWaiting(poll.nextAllowedAt, now);
  const until = poll.nextAllowedAt ? Date.parse(poll.nextAllowedAt) : 0;
  const retrying = waiting
    ? `retrying in ${Math.max(1, Math.ceil((until - now) / MINUTE))} min`
    : 'retrying soon';
  const error = poll.lastError;

  if (!error) {
    // Low on points: the poller waits for the reset, and nothing else says why the list stands still.
    if (waiting && poll.rateLimit && poll.rateLimit.remaining < LOW_RATE_LIMIT) {
      return {
        kind: 'rate_limited',
        tone: 'warning',
        title: 'GitHub rate limit almost used up',
        detail: `Refreshing resumes at ${clock(until)}.`,
        age,
        action: null,
      };
    }
    const limit = Math.max(STALE_MIN_MS, STALE_INTERVALS * intervalMinutes * MINUTE);
    if (!fetchedAt || poll.inFlight || now - Date.parse(fetchedAt) <= limit) return null;
    return {
      kind: 'stale',
      tone: 'warning',
      title: 'Pull requests may be out of date',
      detail: '',
      age,
      action: { type: 'retry', label: 'Refresh now' },
    };
  }

  switch (error.kind) {
    case 'unauthorized':
      return {
        kind: 'unauthorized',
        tone: 'danger',
        title: 'Your GitHub token was revoked or expired',
        detail: 'Prowl stopped refreshing. Sign in again to continue.',
        age,
        action: { type: 'reauthenticate', label: 'Re-authenticate' },
      };
    case 'rate_limited':
      return {
        kind: 'rate_limited',
        tone: 'warning',
        title: waiting ? `Rate limited until ${clock(until)}` : 'GitHub rate limit has reset',
        detail: waiting
          ? 'GitHub is limiting Prowl’s requests, so refreshing is paused.'
          : 'Prowl refreshes again shortly.',
        age,
        action: waiting ? null : RETRY,
      };
    case 'network':
      return {
        kind: 'offline',
        tone: 'warning',
        title: `Offline — ${retrying}`,
        detail: error.message,
        age,
        action: RETRY,
      };
    default:
      return {
        kind: 'error',
        tone: 'danger',
        title: `GitHub error — ${retrying}`,
        detail: error.message,
        age,
        action: RETRY,
      };
  }
}
