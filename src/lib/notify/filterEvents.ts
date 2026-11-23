import type {
  NotificationSettings,
  PrEvent,
  PrEventType,
  PrLocalState,
  TurnReason,
} from '../model';
import { isMuted, isSnoozed } from '../storage/prLocal';
import { isQuietNow } from '../time/quietHours';

/**
 * The events that already tell why a PR became the viewer's move, per `your_turn` reason. A
 * review asked of the viewer (`review_requested`) and the other reasons have none: a stranger's
 * review or an approval does not say it.
 */
const TOLD_BY: Partial<Record<TurnReason, readonly PrEventType[]>> = {
  ci_failed: ['ci_failed'],
  changes_requested: ['changes_requested'],
  feedback: ['comment_new', 'review_new'],
  ready_to_merge: ['ready_to_merge'],
};

/** Whether a kept event of the same PR already says what the turn event `event` would. */
function toldElsewhere(event: PrEvent, kept: readonly PrEvent[]): boolean {
  const by = event.type === 'your_turn' && event.reason ? TOLD_BY[event.reason] : undefined;
  return !!by && kept.some((other) => other.prId === event.prId && by.includes(other.type));
}

/**
 * The events worth a notification now: none when notifications are off or it is quiet time;
 * otherwise those whose type is enabled and whose PR is neither muted nor snoozed, less the
 * `your_turn` events another kept event of their PR already tells (never both; the turn event
 * when the specific type is off). Pass every event of the poll, not only those not yet
 * notified, so a repeated poll drops the same ones.
 */
export function filterEvents(
  events: PrEvent[],
  settings: NotificationSettings,
  local: PrLocalState,
  now: Date = new Date(),
): PrEvent[] {
  if (!settings.enabled || isQuietNow(settings.quietHours, now)) return [];
  const kept = events.filter(
    (event) =>
      settings.events[event.type] &&
      !isMuted(local, event.prId) &&
      !isSnoozed(local, event.prId, now),
  );
  return kept.filter((event) => !toldElsewhere(event, kept));
}
