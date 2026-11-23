import { countMessage, type MessageKey, t } from '../i18n';
import type { PrEvent, PrEventType, TurnReason } from '../model';

export interface NotificationContent {
  title: string;
  message: string;
  contextMessage?: string;
}

const someone = (actor: string | null) => actor ?? t('someone');

/** What the viewer has to do, per reason a `your_turn` event can give (see `whoseTurn`). */
const TURN_TITLES: Partial<Record<TurnReason, MessageKey>> = {
  re_review: 'notifyTurnReReview',
  ci_failed: 'notifyTurnCiFailed',
  changes_requested: 'notifyTurnChangesRequested',
  conflicts: 'notifyTurnConflicts',
  feedback: 'notifyTurnFeedback',
  unresolved_threads: 'notifyTurnUnresolvedThreads',
  update_branch: 'notifyTurnUpdateBranch',
  ready_to_merge: 'notifyTurnReadyToMerge',
};

const TITLES: Record<PrEventType, (actor: string | null, event: PrEvent) => string> = {
  ci_failed: () => t('ciFailed'),
  ci_passed: () => t('ciPassed'),
  review_new: (actor) => t('reviewed', someone(actor)),
  approved: (actor) => t('approved', someone(actor)),
  changes_requested: (actor) => t('requestedChanges', someone(actor)),
  comment_new: (actor) => t('commented', someone(actor)),
  ready_to_merge: () => t('readyToMerge2'),
  merged: (actor) => (actor ? t('mergedBy', actor) : t('merged')),
  closed: (actor) => (actor ? t('closedBy', actor) : t('closed')),
  review_requested: () => t('reviewRequested'),
  your_turn: (_, { reason }) =>
    t((reason && Object.hasOwn(TURN_TITLES, reason) && TURN_TITLES[reason]) || 'yourTurnSection'),
};

/** `acme/widgets#12` */
const ref = (event: PrEvent) => `${event.repo}#${event.number}`;

/** What happened as the title, the PR title as the message, the PR as context. */
export function notificationContent(event: PrEvent): NotificationContent {
  return {
    title: TITLES[event.type](event.actor, event),
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

/** The one notification after quiet hours: what happened while they were on. */
export function quietDigestContent(events: PrEvent[]): NotificationContent {
  const { message } = summaryContent(events);
  return {
    title: countMessage(events.length, 'quietDigestOne', 'quietDigestOther'),
    message,
  };
}
