/**
 * A cheap change detector: GitHub's notifications inbox, read with `If-Modified-Since`. An
 * unchanged inbox answers 304, which does not count against the rate limit, so it can be asked
 * every minute; a change in a pull request thread is the cue for a full poll. Read only: Prowl
 * never marks a notification read. Fine-grained tokens cannot read the inbox (403).
 */
import type { GitHubClient } from './client';

export interface InboxCheck {
  /** A pull request thread changed since `since` (always false on the first check). */
  changed: boolean;
  /** What to send as `If-Modified-Since` next time. */
  lastModified: string | null;
}

/** Asks whether a pull request notification arrived since `since` (GitHub's `Last-Modified`). */
export async function checkInbox(client: GitHubClient, since: string | null): Promise<InboxCheck> {
  const { data, headers, status } = await client.restResponse<{ subject?: { type?: string } }[]>(
    'GET',
    '/notifications?per_page=50',
    undefined,
    since ? { 'If-Modified-Since': since } : {},
  );
  const lastModified = headers.get('last-modified') ?? since;
  if (status === 304 || !since) return { changed: false, lastModified };
  return {
    changed: (data ?? []).some((thread) => thread.subject?.type === 'PullRequest'),
    lastModified,
  };
}
