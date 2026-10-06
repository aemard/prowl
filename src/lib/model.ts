/**
 * Prowl domain model. This is the contract shared by the service worker, the side panel,
 * the GitHub layer and the diff engine. GitHub-specific shapes stay inside src/lib/github;
 * everything else depends only on these types.
 */

/** Aggregated CI state for the head commit. `none` = no checks configured. */
export type CheckState = 'success' | 'failure' | 'pending' | 'none';

/** What CI last concluded: any check state but `pending`. */
export type SettledCheckState = Exclude<CheckState, 'pending'>;

export interface CheckSummary {
  state: CheckState;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** Skipped, neutral and cancelled-by-user checks. */
  neutral: number;
}

/** How a check run or commit status counts: SUCCESS passed; FAILURE and its kin failed. */
export type CheckItemState = 'passed' | 'failed' | 'pending' | 'neutral';

/** One check run or commit status of the head commit, as the expanded card lists it. */
export interface CheckItem {
  name: string;
  state: CheckItemState;
  /** The check's own page; null when GitHub has none. Not yet checked against the allowlist. */
  url: string | null;
  /** The base branch's protection requires it to pass before merging. */
  required: boolean;
}

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | 'none';

export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface Review {
  /** GraphQL node id; used to detect new reviews between polls. */
  id: string;
  author: string;
  state: ReviewState;
  submittedAt: string;
}

export interface Reviewer {
  login: string;
  /** Empty for a deleted account. */
  avatarUrl: string;
  /** `requested`: asked to review and has not reviewed yet. */
  state: ReviewState | 'requested';
}

/** GitHub's `mergeable` field. `unknown` while GitHub computes it. */
export type Mergeable = 'mergeable' | 'conflicting' | 'unknown';

/** GitHub's `mergeStateStatus`, lower-cased. `clean` means ready to merge. */
export type MergeStateStatus =
  | 'clean'
  | 'blocked'
  | 'behind'
  | 'dirty'
  | 'draft'
  | 'has_hooks'
  | 'unstable'
  | 'unknown';

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface Label {
  name: string;
  /** Six hex digits without `#`, validated by the mapper. */
  color: string;
}

export interface Actor {
  login: string;
  avatarUrl: string;
}

export interface PullRequest {
  /** GraphQL node id. Stable key everywhere in Prowl. */
  id: string;
  number: number;
  title: string;
  url: string;
  repo: {
    owner: string;
    name: string;
    /** `owner/name` */
    nameWithOwner: string;
  };
  author: Actor | null;
  state: PullRequestState;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  checks: CheckSummary;
  reviewDecision: ReviewDecision;
  /** Latest review per reviewer, newest first. */
  reviews: Review[];
  /** Logins (or team slugs prefixed with `@`) whose review is requested. */
  requestedReviewers: string[];
  mergeable: Mergeable;
  mergeStateStatus: MergeStateStatus;
  labels: Label[];
  /** Unresolved review threads. */
  unresolvedThreads: number;
  /** Issue comments plus review comments (`totalCommentsCount`). */
  commentCount: number;
  lastComment: { author: string; createdAt: string } | null;
  /** Set once the PR is merged or closed. */
  closedBy: string | null;
  /** Merge methods the repository allows. */
  allowedMergeMethods: MergeMethod[];
  /** What the merge dialog starts on: the method the viewer used last here, else the repo's. */
  defaultMergeMethod: MergeMethod;
  viewerCanUpdate: boolean;
  /** The viewer has write access to the repository (GraphQL has no `viewerCanMerge`). */
  viewerCanMerge: boolean;
}

/**
 * What the expanded card shows beyond `PullRequest`. Fetched when a card is expanded (never
 * polled, never stored): the head commit's checks, who reviewed, and the base branch's rules.
 */
export interface PullRequestDetail {
  /** Failed first, then pending, passed and neutral; GitHub's order within each. */
  checks: CheckItem[];
  /** Checks GitHub counts on the head commit; more than `checks.length` when a cap cut the list. */
  checksTotal: number;
  /** Changes requested first, then requested, approved, commented, dismissed. */
  reviewers: Reviewer[];
  /** Approvals the base branch's protection asks for; null when none, or not visible to the token. */
  requiredApprovals: number | null;
  /** The base branch needs every review conversation resolved before merging. */
  requiresConversationResolution: boolean;
}

export type SectionKind = 'authored' | 'review_requested' | 'mentioned' | 'assigned' | 'custom';

export interface Section {
  id: string;
  kind: SectionKind;
  label: string;
  enabled: boolean;
  /** Only for `custom`: a GitHub search query. `is:pr` is enforced. */
  query?: string;
}

export interface Viewer {
  login: string;
  avatarUrl: string;
  name: string | null;
}

/** Everything one successful poll produced. Persisted by the service worker. */
export interface Snapshot {
  fetchedAt: string;
  viewer: Viewer;
  pullRequests: Record<string, PullRequest>;
  /** Section id -> ordered PR ids. A PR may appear in several sections. */
  sections: Record<string, string[]>;
  /**
   * Custom section id -> why it could not be loaded in this poll (invalid query, or GitHub
   * refused it); such a section has no entry in `sections`. Absent means none.
   */
  sectionErrors?: Record<string, string>;
  /**
   * PR id -> check state of its last poll that was not `pending`, for the PRs whose checks are
   * pending now, so failure -> pending -> success still reports `ci_passed`. Absent means none.
   */
  settledChecks?: Record<string, SettledCheckState>;
}

export type PrEventType =
  | 'ci_failed'
  | 'ci_passed'
  | 'review_new'
  | 'approved'
  | 'changes_requested'
  | 'comment_new'
  | 'ready_to_merge'
  | 'merged'
  | 'closed';

export interface PrEvent {
  /** Deterministic: the same change always produces the same id (used for dedupe). */
  id: string;
  type: PrEventType;
  prId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** Who caused it, when known. */
  actor: string | null;
  at: string;
}

export interface RateLimit {
  limit: number;
  remaining: number;
  /** ISO timestamp. */
  resetAt: string;
}

export type ErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'not_found'
  | 'validation'
  | 'server'
  | 'network'
  | 'graphql';

export interface PollState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** Poll attempts are skipped until this time (backoff or rate limit). */
  nextAllowedAt: string | null;
  consecutiveFailures: number;
  rateLimit: RateLimit | null;
  lastError: { kind: ErrorKind; message: string } | null;
  inFlight: boolean;
}

export type AuthMethod = 'pat' | 'oauth';

export interface AuthState {
  method: AuthMethod;
  token: string;
  /** `classic`, `fine_grained` or `oauth`, from the token prefix. */
  tokenType: 'classic' | 'fine_grained' | 'oauth' | 'unknown';
  /** Classic PAT / OAuth scopes from `X-OAuth-Scopes`; empty for fine-grained tokens. */
  scopes: string[];
  viewer: Viewer;
  createdAt: string;
}

/** Local-only per-PR state. Never sent anywhere. */
export interface PrLocalState {
  /** PR id -> ISO time the snooze ends. */
  snoozed: Record<string, string>;
  /** PR ids with notifications muted. */
  muted: Record<string, true>;
  /** PR id -> `updatedAt` value the user has seen. */
  seen: Record<string, string>;
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

/** `attention`: PRs that need you (CI failing, changes requested, conflicts, ready to merge). */
export type BadgeMode = 'attention' | 'unseen' | 'off';

export type Theme = 'system' | 'light' | 'dark';

export type SortOrder = 'updated' | 'created' | 'repo';

export interface Settings {
  version: 1;
  sections: Section[];
  /** `owner/name` or `owner`. Empty = all repositories. */
  repoInclude: string[];
  /** `owner/name` or `owner`. Applied after include. */
  repoExclude: string[];
  /** Integer minutes, minimum 1, default 2. */
  pollIntervalMinutes: number;
  /** Results fetched per section, 1-100, default 50. */
  maxPerSection: number;
  notifications: NotificationSettings;
  badge: BadgeMode;
  theme: Theme;
  sort: SortOrder;
}

/** Keys used in `chrome.storage.local`. The token never goes to `storage.sync`. */
export const STORAGE_KEYS = {
  settings: 'settings',
  auth: 'auth',
  snapshot: 'snapshot',
  pollState: 'pollState',
  prLocal: 'prLocal',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Messages the side panel sends to the service worker via `chrome.runtime.sendMessage`. */
export type BackgroundRequest =
  | { type: 'poll'; force?: boolean }
  | { type: 'markSeen'; prIds: string[] }
  | { type: 'signedOut' };
