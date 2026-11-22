/**
 * The stored preferences and local state of the domain model: settings, per-PR local state,
 * panel organization and the "whose turn" vocabulary. Re-exported by `model.ts`, which is the
 * module everything imports.
 */
import type { PrEventType, Section } from './model';

/** Local-only per-PR state. Never sent anywhere. */
export interface PrLocalState {
  /** PR id -> ISO time the snooze ends. */
  snoozed: Record<string, string>;
  /** PR ids with notifications muted. */
  muted: Record<string, true>;
  /** PR id -> `updatedAt` value the user has seen. */
  seen: Record<string, string>;
  /** Useful facts observed at that timestamp (CI can change without changing updatedAt). */
  seenFacts?: Record<string, string>;
}

/** Local panel organization for one account; search text is deliberately session-only. */
export interface PanelState {
  login: string;
  activeSectionId?: string;
  foldedGroups: string[];
}

export interface QuietHours {
  enabled: boolean;
  /** Local time, `HH:MM`, 24h. A window may wrap past midnight (22:00 -> 07:00). */
  start: string;
  end: string;
}

export interface NotificationSettings {
  enabled: boolean;
  events: Record<PrEventType, boolean>;
  quietHours: QuietHours;
}

/**
 * `turn`: PRs where it is the viewer's move (`whoseTurn`). `attention`: PRs with failing CI,
 * changes requested, conflicts or ready to merge, whoever has to act. `unseen`: changed since seen.
 */
export type BadgeMode = 'turn' | 'attention' | 'unseen' | 'off';

/** Why a PR is someone's turn, most urgent first for the viewer's own PRs. */
export type TurnReason =
  | 'review_requested'
  | 're_review'
  | 'team_review'
  | 'ci_failed'
  | 'changes_requested'
  | 'conflicts'
  | 'feedback'
  /** Reviewed, but GitHub blocks it while review conversations are unresolved. */
  | 'unresolved_threads'
  /** Reviewed, but the base moved on and strict status checks need the branch updated. */
  | 'update_branch'
  | 'ready_to_merge'
  | 'waiting_on_reviewers'
  | 'waiting_on_checks'
  | 'waiting_on_author'
  /** Ready, with auto-merge on: GitHub merges it on its own. */
  | 'auto_merge'
  /** In GitHub's merge queue: it merges once the queue reaches it. */
  | 'in_merge_queue'
  /** GitHub's merge facts are not read yet for this head: nobody's move until they are. */
  | 'merge_unknown'
  | 'draft'
  | 'closed';

/** Who has to move on a PR: the viewer, one of their teams, someone else, or nobody. */
export interface Turn {
  owner: 'you' | 'team' | 'them' | 'none';
  reason: TurnReason;
  /** Since when, as best the snapshot knows (ISO). */
  since: string;
}

export type Theme = 'system' | 'light' | 'dark';

export type Language = 'system' | 'en' | 'ja' | 'zh-CN' | 'zh-TW' | 'fr' | 'de' | 'es';

export type SortOrder = 'updated' | 'created' | 'repo';

export interface Settings {
  version: 2;
  sections: Section[];
  /** `owner/name` or `owner`. Empty = all repositories. */
  repoInclude: string[];
  /** `owner/name` or `owner`. Applied after include. */
  repoExclude: string[];
  /** Integer minutes, minimum 2, default 2. */
  pollIntervalMinutes: number;
  /** Results fetched per section, 1-100, default 50. */
  maxPerSection: number;
  notifications: NotificationSettings;
  badge: BadgeMode;
  theme: Theme;
  /** `system` follows Chrome's interface language; an explicit choice overrides it. */
  language: Language;
  sort: SortOrder;
  /** The list groups each section's PRs under their repository (independent of `sort`). */
  groupByRepo: boolean;
  /** Expanded cards offer summaries and CI explanations from Chrome's on-device AI. */
  localAi: boolean;
  /**
   * The list's single-key shortcuts (j, k, o, s, t, r, /, ?) are on. Off, only keys with a
   * modifier and the focused control's own keys work (WCAG 2.1.4): speech input and stray keys
   * cannot trigger them. Default true.
   */
  singleKeyShortcuts: boolean;
  /** Legacy sync compatibility key, always normalized to 0. */
  hideStaleAfterDays: number;
  /** Legacy sync compatibility key, always normalized to false. */
  hideDrafts: boolean;
  /** Legacy sync compatibility key, always normalized to false. */
  hideBots: boolean;
  /**
   * Team keys (`org/slug`, lowercase) left out of the team section. Empty = every discovered
   * team is followed, and so is any team discovered later.
   */
  unfollowedTeams: string[];
}
