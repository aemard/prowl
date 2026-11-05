import { countMessage, t } from '../i18n';
import type { PrEvent, PrEventType } from '../model';

export interface NotificationContent {
  title: string;
  message: string;
  contextMessage?: string;
}

const someone = (actor: string | null) => actor ?? t('someone');

const TITLES: Record<PrEventType, (actor: string | null) => string> = {
  ci_failed: () => t('ciFailed'),
  ci_passed: () => t('ciPassed'),
  review_new: (actor) => t('reviewed', someone(actor)),
  approved: (actor) => t('approved', someone(actor)),
  changes_requested: (actor) => t('requestedChanges', someone(actor)),
  comment_new: (actor) => t('commented', someone(actor)),
  ready_to_merge: () => t('readyToMerge2'),
  merged: (actor) => (actor ? t('mergedBy', actor) : t('merged')),
  closed: (actor) => (actor ? t('closedBy', actor) : t('closed')),
};

/** `acme/widgets#12` */
const ref = (event: PrEvent) => `${event.repo}#${event.number}`;

/** What happened as the title, the PR title as the message, the PR as context. */
export function notificationContent(event: PrEvent): NotificationContent {
  return {
    title: TITLES[event.type](event.actor),
    message: event.title,
    contextMessage: ref(event),
  };
}

const LISTED = 3;

/** One notification for a poll with many events: how many, and which PRs. */
export function summaryContent(events: PrEvent[]): NotificationContent {
  const refs = [...new Set(events.map(ref))];
  const more = refs.length - LISTED;
  return {
    title: countMessage(events.length, 'notificationUpdateOne', 'notificationUpdateOther'),
    message: refs.slice(0, LISTED).join(', ') + (more > 0 ? t('andMore', more) : ''),
  };
}
