/**
 * Validators for single stored setting values: each takes `unknown` and returns a valid value or
 * a fallback, never throws. `settings.ts` composes them into `normalizeSettings`.
 */

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function oneOf<T extends string>(value: unknown, allowed: Record<T, true>, fallback: T): T {
  return typeof value === 'string' && Object.hasOwn(allowed, value) ? (value as T) : fallback;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
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

export function normalizeRepoList(value: unknown): string[] {
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

/** `org/slug`, lowercase: what GitHub allows in an organization login and a team slug. */
export const TEAM_KEY = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}$/;

/** Team keys (`org/slug`), lowercased, deduped; anything else is dropped. */
export function normalizeTeamKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().toLowerCase());
  return [...new Set(keys.filter((key) => TEAM_KEY.test(key)))];
}
