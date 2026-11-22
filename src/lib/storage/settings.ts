/**
 * User settings: defaults, migrations, normalization and storage. Every read goes through
 * `normalizeSettings`, so callers always get a complete, valid `Settings` whatever is stored.
 * Single values are validated in `settingsValues.ts`, the section list in `settingsSections.ts`;
 * their public names are exported from here too.
 */
import {
  type BadgeMode,
  type Language,
  type NotificationSettings,
  type PrEventType,
  type Settings,
  type SortOrder,
  STORAGE_KEYS,
  type Theme,
} from '../model';
import { isRecord } from './guards';
import { BUILT_IN_SECTION_KINDS, builtInSection, normalizeSections } from './settingsSections';
import {
  bool,
  clampInt,
  normalizeRepoList,
  normalizeTeamKeys,
  normalizeTime,
  oneOf,
} from './settingsValues';
import { getItem, subscribe, type Unsubscribe, updateItem } from './storage';

export {
  BUILT_IN_SECTION_KINDS,
  type BuiltInSectionKind,
  MAX_SECTION_LABEL_LENGTH,
} from './settingsSections';
export { normalizeRepoPattern, normalizeTime, TEAM_KEY } from './settingsValues';

export const SETTINGS_VERSION: Settings['version'] = 2;
export const MIN_POLL_INTERVAL_MINUTES = 2;
export const MAX_POLL_INTERVAL_MINUTES = 60;
export const MIN_PER_SECTION = 1;
export const MAX_PER_SECTION = 100;

const EVENT_DEFAULTS: Record<PrEventType, boolean> = {
  ci_failed: true,
  ci_passed: true,
  review_new: true,
  approved: true,
  changes_requested: true,
  comment_new: true,
  ready_to_merge: true,
  merged: true,
  closed: true,
  review_requested: true,
  your_turn: true,
};

const BADGE_MODES: Record<BadgeMode, true> = {
  turn: true,
  attention: true,
  unseen: true,
  off: true,
};
const THEMES: Record<Theme, true> = { system: true, light: true, dark: true };
const LANGUAGES: Record<Language, true> = {
  system: true,
  en: true,
  ja: true,
  'zh-CN': true,
  'zh-TW': true,
  fr: true,
  de: true,
  es: true,
};
const SORT_ORDERS: Record<SortOrder, true> = { updated: true, created: true, repo: true };

function keysOf<K extends string>(record: Record<K, unknown>): K[] {
  return Object.keys(record) as K[];
}

/** Every notification event type, in settings-screen order. */
export const PR_EVENT_TYPES: readonly PrEventType[] = keysOf(EVENT_DEFAULTS);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Frozen; use `defaultSettings()` for a copy you can change. */
export const DEFAULT_SETTINGS: Settings = deepFreeze({
  version: SETTINGS_VERSION,
  sections: BUILT_IN_SECTION_KINDS.map((kind) => builtInSection(kind)),
  repoInclude: [],
  repoExclude: [],
  pollIntervalMinutes: 2,
  maxPerSection: 50,
  notifications: {
    enabled: false,
    events: { ...EVENT_DEFAULTS },
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
  },
  badge: 'turn',
  theme: 'system',
  language: 'system',
  sort: 'updated',
  groupByRepo: true,
  localAi: false,
  singleKeyShortcuts: true,
  hideStaleAfterDays: 0,
  hideDrafts: false,
  hideBots: false,
  unfollowedTeams: [],
});

export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

// ---------------------------------------------------------------------------------------------
// Migrations

/** Upgrades raw settings from version `n` to `n + 1`. Must be pure and tolerate junk. */
export type SettingsMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade from. To change the shape of `Settings`: bump
 * `version` in model.ts and `SETTINGS_VERSION`, add `SETTINGS_MIGRATIONS[previous]`, test it.
 */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, SettingsMigration>> = Object.freeze({
  1: (raw) => ({ ...raw, language: raw.language ?? 'system' }),
});

function storedVersion(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
}

/**
 * Runs the migrations from the stored `version` (unversioned data counts as version 1) up to
 * `target` and returns the result with the version it reached. Data from a newer version
 * (after a downgrade) is returned unchanged for `normalizeSettings` to repair best-effort.
 */
export function migrateSettings(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, SettingsMigration>> = SETTINGS_MIGRATIONS,
  target: number = SETTINGS_VERSION,
): Record<string, unknown> {
  let version = storedVersion(raw.version);
  let current = raw;
  while (version < target) {
    const step = migrations[version];
    if (!step) break;
    current = step(current);
    version += 1;
  }
  return { ...current, version };
}

// ---------------------------------------------------------------------------------------------
// Normalization

function normalizeNotifications(value: unknown): NotificationSettings {
  const defaults = DEFAULT_SETTINGS.notifications;
  const raw: Record<string, unknown> = isRecord(value) ? value : {};
  const events: Record<string, unknown> = isRecord(raw.events) ? raw.events : {};
  const quiet: Record<string, unknown> = isRecord(raw.quietHours) ? raw.quietHours : {};
  return {
    enabled: bool(raw.enabled, defaults.enabled),
    events: Object.fromEntries(
      PR_EVENT_TYPES.map((type) => [type, bool(events[type], defaults.events[type])]),
    ) as Record<PrEventType, boolean>,
    quietHours: {
      enabled: bool(quiet.enabled, defaults.quietHours.enabled),
      start: normalizeTime(quiet.start) ?? defaults.quietHours.start,
      end: normalizeTime(quiet.end) ?? defaults.quietHours.end,
    },
  };
}

/**
 * Repairs any stored value into valid `Settings`: runs migrations, defaults missing or invalid
 * fields, clamps numbers, drops unknown keys. Never throws and never mutates its input.
 */
export function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) return defaultSettings();
  const raw = migrateSettings(value);
  return {
    version: SETTINGS_VERSION,
    sections: normalizeSections(raw.sections),
    repoInclude: normalizeRepoList(raw.repoInclude),
    repoExclude: normalizeRepoList(raw.repoExclude),
    pollIntervalMinutes: clampInt(
      raw.pollIntervalMinutes,
      MIN_POLL_INTERVAL_MINUTES,
      MAX_POLL_INTERVAL_MINUTES,
      DEFAULT_SETTINGS.pollIntervalMinutes,
    ),
    maxPerSection: clampInt(
      raw.maxPerSection,
      MIN_PER_SECTION,
      MAX_PER_SECTION,
      DEFAULT_SETTINGS.maxPerSection,
    ),
    notifications: normalizeNotifications(raw.notifications),
    badge: oneOf(raw.badge, BADGE_MODES, DEFAULT_SETTINGS.badge),
    theme: oneOf(raw.theme, THEMES, DEFAULT_SETTINGS.theme),
    language: oneOf(raw.language, LANGUAGES, DEFAULT_SETTINGS.language),
    sort: oneOf(raw.sort, SORT_ORDERS, DEFAULT_SETTINGS.sort),
    groupByRepo: bool(raw.groupByRepo, DEFAULT_SETTINGS.groupByRepo),
    localAi: bool(raw.localAi, DEFAULT_SETTINGS.localAi),
    singleKeyShortcuts: bool(raw.singleKeyShortcuts, DEFAULT_SETTINGS.singleKeyShortcuts),
    // Keep explicit off values for older synced installs (missing stale keys default to 20).
    hideStaleAfterDays: 0,
    hideDrafts: false,
    hideBots: false,
    unfollowedTeams: normalizeTeamKeys(raw.unfollowedTeams),
  };
}

// ---------------------------------------------------------------------------------------------
// Storage

/** The stored settings, normalized (defaults when nothing is stored yet). */
export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await getItem(STORAGE_KEYS.settings));
}

/**
 * Applies a shallow patch (nested objects such as `notifications` are replaced whole) or an
 * updater to the stored settings, normalizes and stores the result, and returns it.
 */
export async function updateSettings(
  patch: Partial<Omit<Settings, 'version'>> | ((current: Settings) => Settings),
): Promise<Settings> {
  return updateItem(STORAGE_KEYS.settings, (stored) => {
    const current = normalizeSettings(stored);
    return normalizeSettings(
      typeof patch === 'function' ? patch(current) : { ...current, ...patch },
    );
  });
}

/**
 * Persists migrated and repaired settings (the defaults on first run). Meant for
 * `runtime.onInstalled`; writes nothing when the stored value is already current.
 */
export async function ensureSettings(): Promise<Settings> {
  return updateItem(STORAGE_KEYS.settings, (stored) => normalizeSettings(stored));
}

/** Calls `listener` with normalized settings whenever they change in any context. */
export function subscribeSettings(listener: (settings: Settings) => void): Unsubscribe {
  return subscribe(STORAGE_KEYS.settings, (value) => listener(normalizeSettings(value)));
}
