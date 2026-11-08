/** Quiet-hour events survive worker and browser restarts; sign-out removes them. */
import type { NotificationSettings, PrEvent, PrLocalState } from '../lib/model';
import { filterEvents } from '../lib/notify/filterEvents';
import { getItem } from '../lib/storage/storage';
import { isQuietNow } from '../lib/time/quietHours';

const KEY = 'deferredNotifications';
const MAX_PENDING = 50;

export function forgetDeferred(): Promise<void> {
  return chrome.storage.local.remove(KEY);
}

export function saveDeferred(events: PrEvent[]): Promise<void> {
  return chrome.storage.local.set({ [KEY]: events.slice(-MAX_PENDING) });
}

/** Revalidate pending PRs against the latest published snapshot, even on empty passes. */
export async function notificationBatch(
  events: PrEvent[],
  settings: NotificationSettings,
  local: PrLocalState,
  notified: Record<string, string>,
): Promise<PrEvent[]> {
  const stored = await chrome.storage.local.get<{ [KEY]?: PrEvent[] }>(KEY);
  const pending = stored[KEY] ?? [];
  const snapshot = pending.length ? await getItem('snapshot') : null;
  const valid = pending.filter((event) => snapshot?.pullRequests[event.prId]?.state === 'open');
  const byId = new Map<string, PrEvent>();
  for (const event of [...valid, ...events]) {
    byId.delete(event.id);
    byId.set(event.id, event);
  }
  const unique = [...byId.values()];
  const fresh = unique.filter((event) => !Object.hasOwn(notified, event.id));
  const eligible = filterEvents(
    fresh,
    {
      ...settings,
      quietHours: { ...settings.quietHours, enabled: false },
    },
    local,
  );
  if (isQuietNow(settings.quietHours)) {
    await saveDeferred(eligible);
    return [];
  }
  // Persist the eligible backlog until delivery succeeds; discard newly ineligible entries.
  if (pending.length) {
    const ids = new Set(pending.map((event) => event.id));
    await saveDeferred(eligible.filter((event) => ids.has(event.id)));
  }
  return eligible;
}
