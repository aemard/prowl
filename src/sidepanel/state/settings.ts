/** Writing settings from the panel: saved at once, and the list refreshed when the scope changed. */

import { signal } from '@preact/signals';
import { updateSettings } from '../../lib/storage/settings';
import { showToast } from '../components/ui/Toast';
import { sendToBackground } from './background';
import { navigate } from './router';

/** Quiet time after the last scope change before the list is refreshed. */
export const REFRESH_DELAY_MS = 800;
/** A one-shot focus request consumed when the lazily loaded settings view mounts. */
export const settingsFocus = signal<'pr-limit' | undefined>(undefined);
export const PR_LIMIT_ID = 'settings-pr-limit';

export function changePrLimit(): void {
  settingsFocus.value = 'pr-limit';
  navigate('settings');
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Asks the worker for a forced poll once changes stop, so enabling three sections in a row polls
 * once. The worker keeps its schedule: only a new interval reschedules (see `registerBackground`).
 * An in-flight poll is followed by one coalesced run using the most recent saved settings.
 */
function refreshSoon(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void sendToBackground({ type: 'poll', force: true, afterCurrent: true });
  }, REFRESH_DELAY_MS);
}

/**
 * Stores a change to the settings (a patch, or an updater for nested values so a click never
 * works from a stale copy). `refresh`: the change decides which pull requests are fetched, so the
 * list should not wait for the next poll. A failed write shows a toast and changes nothing.
 */
export async function saveSettings(
  patch: Parameters<typeof updateSettings>[0],
  { refresh = false }: { refresh?: boolean } = {},
): Promise<void> {
  try {
    await updateSettings(patch);
  } catch {
    showToast({ message: 'Could not save the setting. Try again.', tone: 'danger' });
    return;
  }
  if (refresh) refreshSoon();
}
