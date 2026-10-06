import type { PrEvent, PrEventType } from '../model';

export interface NotificationContent {
  title: string;
  message: string;
  contextMessage?: string;
}

const someone = (actor: string | null) => actor ?? 'Someone';
const by = (verb: string) => (actor: string | null) => (actor ? `${verb} by ${actor}` : verb);

const TITLES: Record<PrEventType, (actor: string | null) => string> = {
  ci_failed: () => 'CI failed',
  ci_passed: () => 'CI passed',
  review_new: (actor) => `${someone(actor)} reviewed`,
  approved: (actor) => `${someone(actor)} approved`,
  changes_requested: (actor) => `${someone(actor)} requested changes`,
  comment_new: (actor) => `${someone(actor)} commented`,
  ready_to_merge: () => 'Ready to merge',
  merged: by('Merged'),
  closed: by('Closed'),
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
    title: `${events.length} pull request updates`,
    message: refs.slice(0, LISTED).join(', ') + (more > 0 ? ` and ${more} more` : ''),
  };
}
