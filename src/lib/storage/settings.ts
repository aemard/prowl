/**
 * User settings: defaults, validation and migrations. Every read goes through
 * `normalizeSettings`, so callers always get a complete, valid `Settings` whatever is stored.
 */
import {
  type BadgeMode,
  type NotificationSettings,
  type PrEventType,
  type Section,
  type SectionKind,
  type Settings,
  type SortOrder,
  STORAGE_KEYS,
  type Theme,
} from '../model';
import { isRecord } from './guards';
import { getItem, subscribe, type Unsubscribe, updateItem } from './storage';

export const SETTINGS_VERSION: Settings['version'] = 1;
export const MIN_POLL_INTERVAL_MINUTES = 1;
export const MAX_POLL_INTERVAL_MINUTES = 60;
export const MIN_PER_SECTION = 1;
export const MAX_PER_SECTION = 100;
export const MAX_SECTION_LABEL_LENGTH = 60;
/** `hideStaleAfterDays` range; 0 never hides. */
export const MIN_HIDE_STALE_DAYS = 0;
export const MAX_HIDE_STALE_DAYS = 365;

export type BuiltInSectionKind = Exclude<SectionKind, 'custom'>;

/** Preset sections in default order. A preset's id is its kind and its label is fixed. */
const BUILT_IN_SECTIONS: Record<BuiltInSectionKind, { label: string; enabled: boolean }> = {
  authored: { label: 'Created by me', enabled: true },
  review_requested: { label: 'Review requested', enabled: false },
  mentioned: { label: 'Mentioned', enabled: false },
  assigned: { label: 'Assigned to me', enabled: false },
};

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
};

const BADGE_MODES: Record<BadgeMode, true> = { attention: true, unseen: true, off: true };
const THEMES: Record<Theme, true> = { system: true, light: true, dark: true };
const SORT_ORDERS: Record<SortOrder, true> = { updated: true, created: true, repo: true };

function keysOf<K extends string>(record: Record<K, unknown>): K[] {
  return Object.keys(record) as K[];
}

export const BUILT_IN_SECTION_KINDS: readonly BuiltInSectionKind[] = keysOf(BUILT_IN_SECTIONS);
/** Every notification event type, in settings-screen order. */
export const PR_EVENT_TYPES: readonly PrEventType[] = keysOf(EVENT_DEFAULTS);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function builtInSection(kind: BuiltInSectionKind, enabled = BUILT_IN_SECTIONS[kind].enabled) {
  return { id: kind, kind, label: BUILT_IN_SECTIONS[kind].label, enabled } satisfies Section;
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
    enabled: true,
    events: { ...EVENT_DEFAULTS },
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
  },
  badge: 'attention',
  theme: 'system',
  sort: 'updated',
  hideStaleAfterDays: 20,
  hideDrafts: false,
  hideBots: false,
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
export const SETTINGS_MIGRATIONS: Readonly<Record<number, SettingsMigration>> = Object.freeze({});

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

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: Record<T, true>, fallback: T): T {
  return typeof value === 'string' && Object.hasOwn(allowed, value) ? (value as T) : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** `HH:MM` (24h) from `H:MM` or `HH:MM`; `null` when it is not a valid time of day. */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = TIME.exec(value.trim());
  if (!match) return null;
  const [, hours = '', minutes = ''] = match;
  return `${hours.padStart(2, '0')}:${minutes}`;
}

const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\/[A-Za-z0-9._-]{1,100})?$/;

/** A trimmed `owner` or `owner/name` as GitHub allows them; `null` when invalid. */
export function normalizeRepoPattern(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const pattern = value.trim();
  if (!REPO_PATTERN.test(pattern)) return null;
  const name = pattern.split('/')[1];
  return name === '.' || name === '..' ? null : pattern;
}

function normalizeRepoList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const pattern = normalizeRepoPattern(item);
    if (pattern === null || seen.has(pattern.toLowerCase())) continue;
    seen.add(pattern.toLowerCase());
    out.push(pattern);
  }
  return out;
}

function isBuiltInKind(value: unknown): value is BuiltInSectionKind {
  return typeof value === 'string' && Object.hasOwn(BUILT_IN_SECTIONS, value);
}

const CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

function label(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, MAX_SECTION_LABEL_LENGTH);
}

/** A section with its stored id (`''` for a custom section whose id must be regenerated). */
function parseSection(value: unknown): Section | null {
  if (!isRecord(value)) return null;
  if (isBuiltInKind(value.kind)) {
    return builtInSection(value.kind, bool(value.enabled, BUILT_IN_SECTIONS[value.kind].enabled));
  }
  if (value.kind !== 'custom') return null;
  const query = typeof value.query === 'string' ? value.query.trim() : '';
  if (query === '') return null;
  const id = typeof value.id === 'string' && CUSTOM_ID.test(value.id) ? value.id : '';
  return {
    id: isBuiltInKind(id) ? '' : id,
    kind: 'custom',
    label: label(value.label, query),
    enabled: bool(value.enabled, true),
    query,
  };
}

/**
 * Keeps the stored order. Presets appear exactly once (missing ones are appended with their
 * defaults, duplicates dropped); custom sections need a query and get a fresh `custom-N` id
 * when theirs is missing, invalid or already used.
 */
function normalizeSections(value: unknown): Section[] {
  if (!Array.isArray(value)) return defaultSettings().sections;
  const parsed = value.map(parseSection).filter((section) => section !== null);
  const reserved = new Set(parsed.map((section) => section.id));
  const used = new Set<string>();
  const sections: Section[] = [];
  let next = 1;
  for (const section of parsed) {
    if (section.kind !== 'custom' && used.has(section.id)) continue;
    if (section.kind === 'custom' && (section.id === '' || used.has(section.id))) {
      while (reserved.has(`custom-${next}`) || used.has(`custom-${next}`)) next += 1;
      section.id = `custom-${next}`;
    }
    used.add(section.id);
    sections.push(section);
  }
  for (const kind of BUILT_IN_SECTION_KINDS) {
    if (!used.has(kind)) sections.push(builtInSection(kind));
  }
  return sections;
}

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
    sort: oneOf(raw.sort, SORT_ORDERS, DEFAULT_SETTINGS.sort),
    hideStaleAfterDays: clampInt(
      raw.hideStaleAfterDays,
      MIN_HIDE_STALE_DAYS,
      MAX_HIDE_STALE_DAYS,
      DEFAULT_SETTINGS.hideStaleAfterDays,
    ),
    hideDrafts: bool(raw.hideDrafts, DEFAULT_SETTINGS.hideDrafts),
    hideBots: bool(raw.hideBots, DEFAULT_SETTINGS.hideBots),
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
