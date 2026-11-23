/**
 * Short relative time for the UI: "just now", "2 min ago", "3 h ago", "5 d ago". Future or
 * unparseable times read as "just now" (clock skew must not show "-1 min ago").
 */
import { t, uiLocale } from '../i18n';

export function formatRelativeTime(
  from: string | number | Date,
  now: number | Date = Date.now(),
): string {
  const seconds = Math.max(0, (new Date(now).getTime() - new Date(from).getTime()) / 1000) || 0;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minAgo', minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('hAgo', hours);
  return t('dAgo', Math.floor(hours / 24));
}

/** A time of day for the UI, "14:05" or "2:05 PM" by the interface language. */
export const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(uiLocale(), { hour: 'numeric', minute: '2-digit' });
