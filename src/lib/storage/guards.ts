/** Shape checks for values read back from storage, whose shape is never trusted. */

/** A non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string that `Date.parse` understands (ISO 8601 in practice). */
export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Epoch milliseconds for a `Date` or a number that already is one. */
export function toMillis(time: Date | number): number {
  return typeof time === 'number' ? time : time.getTime();
}

/** Order-independent equality for JSON-compatible values (what `chrome.storage` holds). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
}
