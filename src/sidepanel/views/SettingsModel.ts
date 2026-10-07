/** Pure helpers and copy for the settings screen. */
import { env } from '../../lib/env';
import { MAX_TEAM_SEARCHES, teamKey } from '../../lib/github/teams';
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
  authored: 'Pull requests you opened',
  review_requested: 'Pull requests that ask you for a review (your teams have their own section)',
  team_review_requested: 'Pull requests that ask one of your teams for a review',
  mentioned: 'Pull requests that mention you',
  assigned: 'Pull requests assigned to you',
};

export const EVENT_LABELS: Record<PrEventType, { label: string; description?: string }> = {
  ci_failed: { label: 'CI fails' },
  ci_passed: { label: 'CI passes', description: 'After it failed before.' },
  review_new: { label: 'New review', description: 'A review that only leaves comments.' },
  approved: { label: 'Approved' },
  changes_requested: { label: 'Changes requested' },
  comment_new: { label: 'New comment' },
  ready_to_merge: { label: 'Ready to merge' },
  merged: { label: 'Merged' },
  closed: { label: 'Closed' },
};

export const BADGE_HINTS: Record<BadgeMode, string> = {
  attention:
    'Counts pull requests that need you: failing CI, changes requested, conflicts or ready to merge.',
  unseen: 'Counts pull requests with changes you have not looked at yet.',
  off: 'The toolbar icon shows no number.',
};

/** What an unusual quiet window means: one that is empty or crosses midnight; null for the rest. */
export function quietHoursNote({ start, end }: Pick<QuietHours, 'start' | 'end'>): string | null {
  if (start === end) return 'Start and end are the same, so nothing is silenced.';
  return end < start ? 'This window crosses midnight and ends the next day.' : null;
}

export const TOKEN_TYPES: Record<AuthState['tokenType'], string> = {
  classic: 'Classic personal access token',
  fine_grained: 'Fine-grained personal access token',
  oauth: 'OAuth token (signed in with GitHub)',
  unknown: 'Unknown',
};

/** What each named permission lets Prowl do, in the order Settings lists them. */
const NAMED_PERMISSIONS: Record<string, { title: string; detail: string }> = {
  sidePanel: { title: 'Side panel', detail: "Show Prowl in Chrome's side panel." },
  storage: { title: 'Storage', detail: 'Keep your settings and pull requests in this browser.' },
  alarms: {
    title: 'Alarms',
    detail: 'Check GitHub on a schedule, even when the panel is closed.',
  },
  notifications: { title: 'Notifications', detail: 'Tell you when a pull request changes.' },
};

export interface PermissionRow {
  title: string;
  detail: string;
}

/** What the sites Prowl may contact let it do. Any other host gets Chrome's own wording. */
function describeOrigin(pattern: string): PermissionRow {
  const title = pattern.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '');
  if (pattern === `${env.apiUrl}/*`) {
    return { title, detail: 'Read your pull requests and act on them, using your token.' };
  }
  if (pattern === `${env.webUrl}/*`) {
    return {
      title,
      detail:
        'Sign in with GitHub. Prowl asks for this only while you sign in, then gives it back.',
    };
  }
  return { title, detail: 'Read and change your data on this site.' };
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
    ...unknown.map((title) => ({ title, detail: 'Not described by this version of Prowl.' })),
    ...origins.map(describeOrigin),
  ];
}
