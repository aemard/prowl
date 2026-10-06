/** Pure helpers and copy for the settings screen. */
import type { AuthState, BadgeMode, PrEventType, QuietHours, SectionKind } from '../../lib/model';

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

export const PRESET_DESCRIPTIONS: Record<Exclude<SectionKind, 'custom'>, string> = {
  authored: 'Pull requests you opened',
  review_requested: 'Pull requests waiting for your review',
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
