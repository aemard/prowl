import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';
import { checkInbox } from './notifications';

const LAST = 'Thu, 05 Nov 2026 10:00:00 GMT';
const NEXT = 'Thu, 05 Nov 2026 10:05:00 GMT';
const BEFORE = '2026-11-05T09:30:00Z';
const AFTER = '2026-11-05T10:04:00Z';

const thread = (type: string, updatedAt: string) => ({
  subject: { type },
  updated_at: updatedAt,
});

function setup(response: Response) {
  const fetch = vi.fn<FetchLike>(async () => response);
  const client = createGitHubClient({ token: 't', apiUrl: 'https://api.github.com', fetch });
  return { client, fetch };
}

describe('checkInbox', () => {
  it('only records the date on the first check', async () => {
    const { client, fetch } = setup(
      jsonResponse([thread('PullRequest', AFTER)], { headers: { 'last-modified': LAST } }),
    );
    expect(await checkInbox(client, null)).toEqual({
      changed: false,
      lastModified: LAST,
      pollSeconds: 60,
    });
    expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty('If-Modified-Since');
  });

  it('sends If-Modified-Since and reads 304 as unchanged', async () => {
    const { client, fetch } = setup(new Response(null, { status: 304 }));
    expect(await checkInbox(client, LAST)).toEqual({
      changed: false,
      lastModified: LAST,
      pollSeconds: 60,
    });
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ 'If-Modified-Since': LAST });
  });

  it('reports a change only for pull request threads updated since the last check', async () => {
    const headers = { 'last-modified': NEXT };
    const pr = setup(jsonResponse([thread('PullRequest', AFTER)], { headers }));
    expect(await checkInbox(pr.client, LAST)).toMatchObject({ changed: true, lastModified: NEXT });
    const issue = setup(jsonResponse([thread('Issue', AFTER), {}], { headers }));
    expect((await checkInbox(issue.client, LAST)).changed).toBe(false);
  });

  it('ignores old unread pull request threads that a change elsewhere sent back', async () => {
    // An issue comment changed the inbox; the PR thread is still unread from earlier.
    const { client } = setup(
      jsonResponse([thread('Issue', AFTER), thread('PullRequest', BEFORE), { subject: {} }], {
        headers: { 'last-modified': NEXT },
      }),
    );
    expect(await checkInbox(client, LAST)).toMatchObject({ changed: false, lastModified: NEXT });
  });

  it("follows GitHub's X-Poll-Interval, never below a minute", async () => {
    const slow = setup(new Response(null, { status: 304, headers: { 'x-poll-interval': '120' } }));
    expect((await checkInbox(slow.client, LAST)).pollSeconds).toBe(120);
    const fast = setup(new Response(null, { status: 304, headers: { 'x-poll-interval': '10' } }));
    expect((await checkInbox(fast.client, LAST)).pollSeconds).toBe(60);
  });
});
