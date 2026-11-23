/**
 * Desktop notifications for a poll's events. The worker can stop at any time, so what must
 * survive lives in `chrome.storage.session` (cleared when the browser closes): `notified`
 * maps the id of every event already reported to its PR's URL. It dedupes events (ids are
 * stable per change, see the diff engine) and tells a click where to go; a notification for
 * one event has that event's id as its id. A summary of several events is recorded under its
 * own id too, pointing at the viewer's pull requests on GitHub. Events silenced only by quiet
 * hours wait in `chrome.storage.local` under `quietHeld` (Chrome is often closed overnight) and
 * become one digest notification at the first poll after the window ends.
 */

import { env } from '../lib/env';
import { t } from '../lib/i18n';
import type { NotificationSettings, PrEvent, PrLocalState } from '../lib/model';
import { filterEvents } from '../lib/notify/filterEvents';
import {
  type NotificationContent,
  notificationContent,
  quietDigestContent,
  summaryContent,
} from '../lib/notify/messages';
import { freshHeld, holdEvents } from '../lib/notify/quietDigest';
import { snooze, updatePrLocal } from '../lib/storage/prLocal';
import { getItem, removeItems, setItem } from '../lib/storage/storage';
import { isQuietNow } from '../lib/time/quietHours';
import { isGitHubUrl } from '../lib/url';

const NOTIFIED = 'notified';
/** Ids remembered; older ones are forgotten first. */
const MAX_NOTIFIED = 300;
/** More events than this in one poll become one summary notification. */
const MAX_SEPARATE = 3;
const ICON = 'icons/icon-128.png';
/** The buttons of a notification about one pull request, in this order. */
const buttons = () => [{ title: t('open') }, { title: t('snooze1H') }];
const SNOOZE_MS = 60 * 60 * 1000;

type Notified = Record<string, string>;

async function readNotified(): Promise<Notified> {
  const stored = await chrome.storage.session.get<{ [NOTIFIED]?: Notified }>(NOTIFIED);
  return stored[NOTIFIED] ?? {};
}

/** Forgets what was reported and what waits for the digest (sign-out). */
export async function forgetNotified(): Promise<void> {
  await Promise.all([chrome.storage.session.remove(NOTIFIED), removeItems('quietHeld')]);
}

/** Keeps the events quiet hours silenced (and nothing else would have) for the digest. */
async function hold(
  events: PrEvent[],
  notified: Notified,
  settings: NotificationSettings,
  local: PrLocalState,
) {
  const audible = { ...settings, quietHours: { ...settings.quietHours, enabled: false } };
  const kept = filterEvents(events, audible, local).filter((e) => !Object.hasOwn(notified, e.id));
  if (kept.length === 0) return;
  const now = Date.now();
  await setItem('quietHeld', holdEvents(freshHeld(await getItem('quietHeld'), now), kept, now));
}

/** After quiet hours: one digest of what waited, still enabled, unmuted and not yet reported. */
async function flushHeld(
  notified: Notified,
  settings: NotificationSettings,
  local: PrLocalState,
): Promise<[string, string][]> {
  const stored = await getItem('quietHeld');
  if (stored === undefined) return [];
  await removeItems('quietHeld');
  const held = freshHeld(stored, Date.now()).map(({ event }) => event);
  const due = filterEvents(held, settings, local).filter((e) => !Object.hasOwn(notified, e.id));
  if (due.length === 0) return [];
  const id = `digest:${Date.now()}`;
  await show(id, quietDigestContent(due));
  return [...due.map((e) => [e.id, e.url] as [string, string]), [id, `${env.webUrl}/pulls`]];
}

function show(id: string, content: NotificationContent, buttons?: { title: string }[]) {
  return chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(ICON),
    ...content,
    ...(buttons ? { buttons } : {}),
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
    const notified = await readNotified();
    if (settings.enabled && isQuietNow(settings.quietHours))
      return await hold(events, notified, settings, local);
    const digest = await flushHeld(notified, settings, local);
    const reported = new Set([...Object.keys(notified), ...digest.map(([id]) => id)]);
    // Filtered before dropping what was reported, so a repeated poll drops the same turn events.
    const shown = filterEvents(events, settings, local).filter((e) => !reported.has(e.id));
    const kept = [
      ...Object.entries(notified),
      ...digest,
      ...shown.map((e) => [e.id, e.url] as const),
    ];
    if (shown.length === 0) {
      if (digest.length > 0)
        await chrome.storage.session.set({
          [NOTIFIED]: Object.fromEntries(kept.slice(-MAX_NOTIFIED)),
        });
      return;
    }
    if (shown.length <= MAX_SEPARATE) {
      for (const event of shown) await show(event.id, notificationContent(event), buttons());
    } else {
      const id = `summary:${Date.now()}`;
      await show(id, summaryContent(shown));
      kept.push([id, `${env.webUrl}/pulls`]);
    }
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

/**
 * "Open" does what a click does. "Snooze 1 h" snoozes the pull request (an event id starts with
 * its PR's id, see the diff engine) and clears the notification. Never rejects.
 */
export async function onNotificationButtonClicked(id: string, index: number): Promise<void> {
  if (index === 0) return onNotificationClicked(id);
  try {
    const notified = await readNotified();
    await chrome.notifications.clear(id);
    if (index !== 1 || !Object.hasOwn(notified, id)) return;
    const prId = id.slice(0, id.indexOf(':'));
    await updatePrLocal((state) => snooze(state, prId, Date.now() + SNOOZE_MS));
  } catch (error) {
    console.error('Prowl: a notification button failed', error);
  }
}
