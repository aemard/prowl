/**
 * The toolbar icon badge. It is derived entirely from storage (`snapshot`, `prLocal` and
 * `settings.badge`), so any context may change those and the badge follows: `watchBadge()`
 * repaints on every change, and the poller repaints at the end of each poll.
 */
import { type BadgeView, computeBadge, NO_BADGE } from '../lib/badge/computeBadge';
import { normalizePrLocal } from '../lib/storage/prLocal';
import { normalizeSettings } from '../lib/storage/settings';
import { getItems, subscribe, withLock } from '../lib/storage/storage';

/** `--color-danger-solid` and `--color-accent-solid` of src/styles/tokens.css (light theme). */
export const BADGE_COLORS = { danger: '#c2272d', accent: '#007a6d' } as const;

const LOCK = 'prowl:badge';

/**
 * Paints one at a time: each repaint reads storage inside the lock, so the last one to run
 * always shows the latest state. Never rejects: a failing badge must not fail a poll.
 */
function paint(view: () => Promise<BadgeView>): Promise<void> {
  return withLock(LOCK, async () => {
    try {
      const { text, title, danger } = await view();
      await Promise.all([
        chrome.action.setBadgeText({ text }),
        chrome.action.setBadgeBackgroundColor({
          color: danger ? BADGE_COLORS.danger : BADGE_COLORS.accent,
        }),
        chrome.action.setTitle({ title }),
      ]);
    } catch (error) {
      console.error('Prowl: updating the badge failed', error);
    }
  });
}

/** Repaints the badge from what is stored now. */
export function updateBadge(): Promise<void> {
  return paint(async () => {
    const { snapshot, settings, prLocal } = await getItems(['snapshot', 'settings', 'prLocal']);
    return computeBadge(
      snapshot,
      normalizePrLocal(prLocal),
      normalizeSettings(settings).badge,
      Date.now(),
    );
  });
}

/** Empties the badge whatever is stored (sign-out). */
export function clearBadge(): Promise<void> {
  return paint(async () => NO_BADGE);
}

/** Repaints whenever the snapshot, the local PR state or the badge setting changes. */
export function watchBadge(): void {
  for (const key of ['snapshot', 'prLocal', 'settings'] as const) {
    subscribe(key, () => void updateBadge());
  }
}
