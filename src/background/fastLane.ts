/**
 * Near-real-time news between polls, from the `inbox` alarm (every minute):
 * - a conditional read of the notifications inbox (`checkInbox`); a change in a pull request
 *   thread starts a poll at once. Off for tokens that cannot read the inbox (fine-grained ones,
 *   or a 403/404) for the browser session.
 * - while CI runs on a listed pull request, a poll every minute, so a red or green build shows
 *   up within a minute (third-party CI never reaches the inbox).
 * Also a poll when Chrome comes back to the foreground after the list aged past the interval.
 */
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { GitHubError } from '../lib/github/errors';
import { checkInbox } from '../lib/github/notifications';
import type { AuthState, Snapshot } from '../lib/model';
import { normalizeSettings } from '../lib/storage/settings';
import { getItems } from '../lib/storage/storage';
import { INBOX_ALARM, poll } from './poller';

export { INBOX_ALARM };

const STATE = 'inbox';
/** CI-driven polls run when the list is at least this old (alarms fire about once a minute). */
const CI_POLL_MS = 50_000;

type InboxState = { lastModified: string | null; off?: true };

async function inboxChanged(auth: AuthState): Promise<boolean> {
  if (auth.tokenType === 'fine_grained') return false;
  const stored = (await chrome.storage.session.get<{ [STATE]?: InboxState }>(STATE))[STATE];
  if (stored?.off) return false;
  try {
    const client = createGitHubClient({ token: auth.token, apiUrl: env.apiUrl });
    const { changed, lastModified } = await checkInbox(client, stored?.lastModified ?? null);
    await chrome.storage.session.set({ [STATE]: { lastModified } });
    return changed;
  } catch (error) {
    // A token without inbox access stops asking for this browser session.
    if (error instanceof GitHubError && ['forbidden', 'not_found'].includes(error.kind))
      await chrome.storage.session.set({ [STATE]: { lastModified: null, off: true } });
    return false;
  }
}

const listed = (snapshot: Snapshot) =>
  [...new Set(Object.values(snapshot.sections).flat())].flatMap(
    (id) => snapshot.pullRequests[id] ?? [],
  );

/** CI is running on a listed open pull request, and the list is a minute old. */
function ciRunning(snapshot: Snapshot | undefined, now: number): boolean {
  if (!snapshot || now - Date.parse(snapshot.fetchedAt) < CI_POLL_MS) return false;
  return listed(snapshot).some((pr) => pr.state === 'open' && pr.checks.state === 'pending');
}

/** Runs on the `inbox` alarm. Never rejects. */
export async function checkFastLane(): Promise<void> {
  try {
    const { auth, snapshot } = await getItems(['auth', 'snapshot']);
    if (!auth) return;
    if ((await inboxChanged(auth)) || ciRunning(snapshot, Date.now()))
      await poll({ afterCurrent: true });
  } catch (error) {
    console.error('Prowl: the fast lane failed', error);
  }
}

/** A Chrome window got focus: poll when the list is older than the poll interval. */
export async function onChromeFocused(windowId: number): Promise<void> {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const { snapshot, settings } = await getItems(['snapshot', 'settings']);
  const age = Date.now() - Date.parse(snapshot?.fetchedAt ?? '');
  if (!(age < normalizeSettings(settings).pollIntervalMinutes * 60_000)) await poll();
}
