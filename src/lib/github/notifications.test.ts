import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';
import { checkInbox } from './notifications';

const LAST = 'Thu, 05 Nov 2026 10:00:00 GMT';
const NEXT = 'Thu, 05 Nov 2026 10:05:00 GMT';

function setup(response: Response) {
  const fetch = vi.fn<FetchLike>(async () => response);
  const client = createGitHubClient({ token: 't', apiUrl: 'https://api.github.com', fetch });
  return { client, fetch };
}

describe('checkInbox', () => {
  it('only records the date on the first check', async () => {
    const { client, fetch } = setup(
      jsonResponse([{ subject: { type: 'PullRequest' } }], { headers: { 'last-modified': LAST } }),
    );
    expect(await checkInbox(client, null)).toEqual({ changed: false, lastModified: LAST });
    expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty('If-Modified-Since');
  });

  it('sends If-Modified-Since and reads 304 as unchanged', async () => {
    const { client, fetch } = setup(new Response(null, { status: 304 }));
    expect(await checkInbox(client, LAST)).toEqual({ changed: false, lastModified: LAST });
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ 'If-Modified-Since': LAST });
  });

  it('reports a change only for pull request threads', async () => {
    const headers = { 'last-modified': NEXT };
    const pr = setup(jsonResponse([{ subject: { type: 'PullRequest' } }], { headers }));
    expect(await checkInbox(pr.client, LAST)).toEqual({ changed: true, lastModified: NEXT });
    const issue = setup(jsonResponse([{ subject: { type: 'Issue' } }, {}], { headers }));
    expect((await checkInbox(issue.client, LAST)).changed).toBe(false);
  });
});
