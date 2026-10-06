/**
 * Desktop notifications for a poll's events. The worker can stop at any time, so what must
 * survive lives in `chrome.storage.session` (cleared when the browser closes): `notified`
 * maps the id of every event already reported to its PR's URL. It dedupes events (ids are
 * stable per change, see the diff engine) and tells a click where to go; a notification for
 * one event has that event's id as its id.
 */
import type { NotificationSettings, PrEvent, PrLocalState } from '../lib/model';
import { filterEvents } from '../lib/notify/filterEvents';
import {
  type NotificationContent,
  notificationContent,
  summaryContent,
} from '../lib/notify/messages';
import { isGitHubUrl } from '../lib/url';

const NOTIFIED = 'notified';
/** Ids remembered; older ones are forgotten first. */
const MAX_NOTIFIED = 300;
/** More events than this in one poll become one summary notification. */
const MAX_SEPARATE = 3;
const ICON = 'icons/icon-128.png';

type Notified = Record<string, string>;

async function readNotified(): Promise<Notified> {
  const stored = await chrome.storage.session.get<{ [NOTIFIED]?: Notified }>(NOTIFIED);
  return stored[NOTIFIED] ?? {};
}

/** Forgets what was reported (sign-out). */
export function forgetNotified(): Promise<void> {
  return chrome.storage.session.remove(NOTIFIED);
}

function show(id: string, content: NotificationContent) {
  return chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(ICON),
    ...content,
  });
}

/**
 * Notifies about the events of one poll that pass the settings and the PRs' local state, once
 * per event id. Never rejects: a failing notification must not fail the poll.
 */
export async function notifyEvents(
  events: PrEvent[],
  settings: NotificationSettings,
  local: PrLocalState,
): Promise<void> {
  try {
    if (events.length === 0) return;
    const notified = await readNotified();
    const fresh = events.filter((event) => !Object.hasOwn(notified, event.id));
    const shown = filterEvents(fresh, settings, local);
    if (shown.length === 0) return;
    if (shown.length <= MAX_SEPARATE) {
      for (const event of shown) await show(event.id, notificationContent(event));
    } else {
      await show(`summary:${Date.now()}`, summaryContent(shown));
    }
    const kept = [...Object.entries(notified), ...shown.map((e) => [e.id, e.url] as const)];
    await chrome.storage.session.set({ [NOTIFIED]: Object.fromEntries(kept.slice(-MAX_NOTIFIED)) });
  } catch (error) {
    console.error('Prowl: notifying failed', error);
  }
}

/** A click opens the PR (when its URL is on GitHub) and clears the notification. */
export async function onNotificationClicked(id: string): Promise<void> {
  try {
    const notified = await readNotified();
    const url = Object.hasOwn(notified, id) ? notified[id] : undefined;
    await chrome.notifications.clear(id);
    if (url && isGitHubUrl(url)) await chrome.tabs.create({ url });
  } catch (error) {
    console.error('Prowl: opening a notification failed', error);
  }
}
