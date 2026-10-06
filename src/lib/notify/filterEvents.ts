import type { NotificationSettings, PrEvent, PrLocalState } from '../model';
import { isMuted, isSnoozed } from '../storage/prLocal';
import { isQuietNow } from '../time/quietHours';

/**
 * The events worth a notification now: none when notifications are off or it is quiet time;
 * otherwise those whose type is enabled and whose PR is neither muted nor snoozed.
 */
export function filterEvents(
  events: PrEvent[],
  settings: NotificationSettings,
  local: PrLocalState,
  now: Date = new Date(),
): PrEvent[] {
  if (!settings.enabled || isQuietNow(settings.quietHours, now)) return [];
  return events.filter(
    (event) =>
      settings.events[event.type] &&
      !isMuted(local, event.prId) &&
      !isSnoozed(local, event.prId, now),
  );
}
