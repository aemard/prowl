import { countMessage, t, uiLocale } from '../../lib/i18n';
/**
 * What the status banner says about the last poll, or about a token that expires soon. Pure: the
 * component only renders it.
 */
import type { PollState } from '../../lib/model';
import { isWaiting, LOW_RATE_LIMIT } from '../../lib/time/backoff';
import { formatRelativeTime } from '../../lib/time/relative';

export type BannerKind =
  | 'unauthorized'
  | 'rate_limited'
  | 'offline'
  | 'error'
  | 'stale'
  | 'expiring';

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
const DAY = 24 * 60 * MINUTE;
/** A token GitHub says expires within this many days gets a banner. */
const EXPIRY_WARNING_DAYS = 7;
/** With no error to explain it, a snapshot older than this many poll intervals is stale. */
const STALE_INTERVALS = 5;
const STALE_MIN_MS = 10 * MINUTE;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(uiLocale(), { hour: 'numeric', minute: '2-digit' });

const RETRY = { type: 'retry', label: t('retry') } as const;

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
      ? t('lastUpdated', formatRelativeTime(fetchedAt, now))
      : '';
  const waiting = isWaiting(poll.nextAllowedAt, now);
  const until = poll.nextAllowedAt ? Date.parse(poll.nextAllowedAt) : 0;
  const retrying = waiting
    ? t('retryingInMin', Math.max(1, Math.ceil((until - now) / MINUTE)))
    : t('retryingSoon');
  const error = poll.lastError;

  if (!error) {
    // Low on points: the poller waits for the reset, and nothing else says why the list stands still.
    if (waiting && poll.rateLimit && poll.rateLimit.remaining < LOW_RATE_LIMIT) {
      return {
        kind: 'rate_limited',
        tone: 'warning',
        title: t('githubRateLimitAlmostUsedUp'),
        detail: t('refreshingResumesAt', clock(until)),
        age,
        action: null,
      };
    }
    const limit = Math.max(STALE_MIN_MS, STALE_INTERVALS * intervalMinutes * MINUTE);
    if (!fetchedAt || poll.inFlight || now - Date.parse(fetchedAt) <= limit) return null;
    return {
      kind: 'stale',
      tone: 'warning',
      title: t('pullRequestsMayBeOutOfDate'),
      detail: '',
      age,
      action: { type: 'retry', label: t('refreshNow') },
    };
  }

  switch (error.kind) {
    case 'unauthorized':
      return {
        kind: 'unauthorized',
        tone: 'danger',
        title: t('yourGithubTokenWasRevokedOrExpired'),
        detail: t('prowlStoppedRefreshingSignInAgainToContinue'),
        age,
        action: { type: 'reauthenticate', label: t('reAuthenticate') },
      };
    case 'rate_limited':
      return {
        kind: 'rate_limited',
        tone: 'warning',
        title: waiting ? t('rateLimitedUntil', clock(until)) : t('githubRateLimitHasReset'),
        detail: waiting
          ? t('githubIsLimitingProwlSRequestsSoRefreshingIs')
          : t('prowlRefreshesAgainShortly'),
        age,
        action: waiting ? null : RETRY,
      };
    case 'network':
      return {
        kind: 'offline',
        tone: 'warning',
        title: t('offline', retrying),
        detail: error.message,
        age,
        action: RETRY,
      };
    default:
      return {
        kind: 'error',
        tone: 'danger',
        title: t('githubError', retrying),
        detail: error.message,
        age,
        action: RETRY,
      };
  }
}

/**
 * A week before GitHub stops accepting the token, a banner that says when and leads to the sign-in
 * screen, so a new token replaces it before the list stops refreshing. Null otherwise: no known
 * expiry, or already past it (the next poll's 401 then says so).
 */
export function describeTokenExpiry(
  expiresAt: string | null | undefined,
  now: number,
): Banner | null {
  const left = expiresAt ? Date.parse(expiresAt) - now : Number.NaN;
  if (!(left > 0 && left <= EXPIRY_WARNING_DAYS * DAY)) return null;
  const days = Math.floor(left / DAY);
  const when = days === 0 ? t('inLessThanADay') : countMessage(days, 'inDaysOne', 'inDaysOther');
  return {
    kind: 'expiring',
    tone: 'warning',
    title: t('yourGithubTokenExpires', when),
    detail: t('createANewOneAndSignInWithIt'),
    age: '',
    action: { type: 'reauthenticate', label: t('renewToken') },
  };
}
