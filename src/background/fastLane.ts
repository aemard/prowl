/**
 * Faster news between polls: every minute, a conditional read of the notifications inbox
 * (`checkInbox`); a change in a pull request thread starts a poll at once. Off for tokens that
 * cannot read the inbox (fine-grained ones, or a 403/404), which keep the regular schedule.
 */
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { GitHubError } from '../lib/github/errors';
import { checkInbox } from '../lib/github/notifications';
import { getItem } from '../lib/storage/storage';
import { INBOX_ALARM, poll } from './poller';

export { INBOX_ALARM };

const STATE = 'inbox';

type InboxState = { lastModified: string | null; off?: true };

/** Runs on the `inbox` alarm. Never rejects. */
export async function checkFastLane(): Promise<void> {
  try {
    const auth = await getItem('auth');
    if (!auth || auth.tokenType === 'fine_grained') return;
    const stored = (await chrome.storage.session.get<{ [STATE]?: InboxState }>(STATE))[STATE];
    if (stored?.off) return;
    const client = createGitHubClient({ token: auth.token, apiUrl: env.apiUrl });
    const { changed, lastModified } = await checkInbox(client, stored?.lastModified ?? null);
    await chrome.storage.session.set({ [STATE]: { lastModified } });
    if (changed) await poll({ afterCurrent: true });
  } catch (error) {
    // A token without inbox access stops asking for this browser session.
    if (error instanceof GitHubError && ['forbidden', 'not_found'].includes(error.kind))
      await chrome.storage.session.set({ [STATE]: { lastModified: null, off: true } });
  }
}
