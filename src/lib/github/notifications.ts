/**
 * A cheap change detector: GitHub's notifications inbox, read with `If-Modified-Since`. An
 * unchanged inbox answers 304, which does not count against the rate limit, so it can be asked
 * every minute (or as often as `X-Poll-Interval` allows); a pull request thread updated since
 * the last check that the list could show is the cue for a full poll. The inbox lists every
 * unread thread, so a change elsewhere (an issue, a thread marked read) brings back old pull
 * request threads: only those updated after the previous `Last-Modified` count. Read only:
 * Prowl never marks a notification read. Fine-grained tokens cannot read the inbox (403).
 */
import type { Snapshot } from '../model';
import type { GitHubClient } from './client';
import { headerCount } from './rateLimit';

export interface InboxCheck {
  /** A relevant pull request thread was updated since `since` (always false on the first check). */
  changed: boolean;
  /** What to send as `If-Modified-Since` next time. */
  lastModified: string | null;
  /** GitHub's `X-Poll-Interval`: ask again no sooner than this many seconds. */
  pollSeconds: number;
}

/** GitHub's documented default when it sends no `X-Poll-Interval`. */
const DEFAULT_POLL_SECONDS = 60;

/**
 * Why GitHub notified the viewer, for the reasons a preset section searches (author, review
 * asked of them or their team, mention, assignee): such a thread may be a PR no section lists
 * yet. Any other reason (a watched repository, a thread the viewer subscribed to, CI activity)
 * counts only in a repository the list already shows.
 */
const SECTION_REASONS = new Set(['author', 'review_requested', 'mention', 'assign']);

type Thread = {
  updated_at?: string;
  reason?: string;
  subject?: { type?: string };
  repository?: { full_name?: string };
};

/** The repositories of the pull requests `snapshot` holds, lowercase `owner/name`. */
export function listedRepos(snapshot: Snapshot | undefined): Set<string> {
  const prs = Object.values(snapshot?.pullRequests ?? {});
  return new Set(prs.map(({ repo }) => repo.nameWithOwner.toLowerCase()));
}

const relevant = (thread: Thread, repos: ReadonlySet<string>) =>
  SECTION_REASONS.has(thread.reason ?? '') ||
  repos.has(thread.repository?.full_name?.toLowerCase() ?? '');

/**
 * Asks whether a pull request notification the list could show arrived since `since` (GitHub's
 * `Last-Modified`): in one of `repos` (`listedRepos`), or for a reason a section searches.
 */
export async function checkInbox(
  client: GitHubClient,
  since: string | null,
  repos: ReadonlySet<string>,
): Promise<InboxCheck> {
  const { data, headers, status } = await client.restResponse<Thread[] | undefined>(
    'GET',
    '/notifications?per_page=50',
    undefined,
    { headers: since ? { 'If-Modified-Since': since } : {}, accept: [304] },
  );
  const lastModified = headers.get('last-modified') ?? since;
  const pollSeconds = Math.max(
    DEFAULT_POLL_SECONDS,
    headerCount(headers, 'x-poll-interval') ?? DEFAULT_POLL_SECONDS,
  );
  const after = Date.parse(since ?? '');
  if (status === 304 || !Number.isFinite(after) || !Array.isArray(data))
    return { changed: false, lastModified, pollSeconds };
  const changed = data.some(
    (thread) =>
      thread.subject?.type === 'PullRequest' &&
      Date.parse(thread.updated_at ?? '') > after &&
      relevant(thread, repos),
  );
  return { changed, lastModified, pollSeconds };
}
