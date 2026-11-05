/** Pure helpers and copy for the settings screen. */
import { env } from '../../lib/env';
import { MAX_TEAM_SEARCHES, teamKey } from '../../lib/github/teams';
import { countMessage, t, uiLocale } from '../../lib/i18n';
import type {
  AuthState,
  BadgeMode,
  PrEventType,
  QuietHours,
  SectionKind,
  Team,
} from '../../lib/model';

/** GitHub's GraphQL budget per hour for one token. */
export const HOURLY_POINTS = 5000;

/** Nested connections `ProwlSearch` asks for per pull request (see docs/architecture.md). */
const CONNECTIONS_PER_PR = 7;

/**
 * About what the polling costs, in GraphQL points an hour: GitHub counts the requests every
 * connection could need, divides by 100 and rounds up, per search. Matches the cost table in
 * docs/architecture.md (one section of 50 pull requests every 2 minutes is about 120).
 */
export function estimatedPointsPerHour(
  sections: number,
  perSection: number,
  intervalMinutes: number,
): number {
  const perSearch = Math.ceil((1 + perSection * CONNECTIONS_PER_PR) / 100);
  return Math.round((sections * perSearch * 60) / intervalMinutes);
}

/** Searches the team section runs per poll: one per followed team, capped like the worker. */
export function teamSearches(list: readonly Team[], unfollowed: readonly string[]): number {
  const skip = new Set(unfollowed);
  return Math.min(list.filter((team) => !skip.has(teamKey(team))).length, MAX_TEAM_SEARCHES);
}

export const PRESET_DESCRIPTIONS: Record<Exclude<SectionKind, 'custom'>, string> = {
  authored: t('pullRequestsYouOpened'),
  review_requested: t('pullRequestsThatAskYouForAReviewYour'),
  team_review_requested: t('pullRequestsThatAskOneOfYourTeamsFor'),
  mentioned: t('pullRequestsThatMentionYou'),
  assigned: t('pullRequestsAssignedToYou'),
};

export const EVENT_LABELS: Record<PrEventType, { label: string; description?: string }> = {
  ci_failed: { label: t('ciFails') },
  ci_passed: { label: t('ciPasses'), description: t('afterItFailedBefore') },
  review_new: { label: t('newReview'), description: t('aReviewThatOnlyLeavesComments') },
  approved: { label: t('approved2') },
  changes_requested: { label: t('changesRequested2') },
  comment_new: { label: t('newComment') },
  ready_to_merge: { label: t('readyToMerge2') },
  merged: { label: t('merged') },
  closed: { label: t('closed') },
};

export const BADGE_HINTS: Record<BadgeMode, string> = {
  attention: t('countsPullRequestsThatNeedYouFailingCiChanges'),
  unseen: t('countsPullRequestsWithChangesYouHaveNotLooked'),
  off: t('theToolbarIconShowsNoNumber'),
};

/** What an unusual quiet window means: one that is empty or crosses midnight; null for the rest. */
export function quietHoursNote({ start, end }: Pick<QuietHours, 'start' | 'end'>): string | null {
  if (start === end) return t('startAndEndAreTheSameSoNothingIs');
  return end < start ? t('thisWindowCrossesMidnightAndEndsTheNextDay') : null;
}

export const TOKEN_TYPES: Record<AuthState['tokenType'], string> = {
  classic: t('classicPersonalAccessToken'),
  fine_grained: t('fineGrainedPersonalAccessToken'),
  oauth: t('oauthTokenSignedInWithGithub'),
  unknown: t('unknown'),
};

const DAY = 24 * 60 * 60_000;

/**
 * When the token expires, for the Account facts: "Never", "Nov 30, 2026 (in 31 days)" or
 * "Expired on …"; null when Prowl does not know (an older sign-in), so the row stays out.
 */
export function tokenExpiry(expiresAt: string | null | undefined, now: number): string | null {
  if (expiresAt === undefined) return null;
  if (expiresAt === null) return t('never');
  const date = new Date(expiresAt).toLocaleDateString(uiLocale(), { dateStyle: 'medium' });
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) return t('expiredOn', date);
  const days = Math.floor(left / DAY);
  return t(
    'expiryDate',
    date,
    days === 0 ? t('inLessThanADay') : countMessage(days, 'inDaysOne', 'inDaysOther'),
  );
}

/** What each named permission lets Prowl do, in the order Settings lists them. */
const NAMED_PERMISSIONS: Record<string, { title: string; detail: string }> = {
  sidePanel: { title: t('sidePanel'), detail: t('showProwlInChromeSSidePanel') },
  storage: { title: t('storage'), detail: t('keepYourSettingsAndPullRequestsInThisBrowser') },
  alarms: {
    title: t('alarms'),
    detail: t('checkGithubOnAScheduleEvenWhenThePanel'),
  },
  notifications: { title: t('notifications'), detail: t('tellYouWhenAPullRequestChanges') },
};

export interface PermissionRow {
  title: string;
  detail: string;
}

/** What the sites Prowl may contact let it do. Any other host gets Chrome's own wording. */
function describeOrigin(pattern: string): PermissionRow {
  const title = pattern.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '');
  if (pattern === `${env.apiUrl}/*`) {
    return { title, detail: t('readYourPullRequestsAndActOnThemUsing') };
  }
  if (pattern === `${env.webUrl}/*`) {
    return {
      title,
      detail: t('signInWithGithubProwlAsksForThisOnly'),
    };
  }
  return { title, detail: t('readAndChangeYourDataOnThisSite') };
}

/**
 * Plain-language rows for what Chrome says Prowl may do right now (`chrome.permissions.getAll()`):
 * the named permissions Prowl knows first, any other after them under its own name, then the sites.
 */
export function describePermissions({
  permissions = [],
  origins = [],
}: {
  permissions?: readonly string[];
  origins?: readonly string[];
}): PermissionRow[] {
  const known = Object.keys(NAMED_PERMISSIONS).filter((name) => permissions.includes(name));
  const unknown = permissions.filter((name) => !Object.hasOwn(NAMED_PERMISSIONS, name));
  return [
    ...known.map((name) => NAMED_PERMISSIONS[name] as PermissionRow),
    ...unknown.map((title) => ({ title, detail: t('notDescribedByThisVersionOfProwl') })),
    ...origins.map(describeOrigin),
  ];
}
