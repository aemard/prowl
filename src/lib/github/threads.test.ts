import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { threadNode, threadsResponse } from '../../../tests/fixtures/threads';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';
import { fetchReviewThreads, replyToThread, resolveThread } from './threads';

function setup(data: unknown) {
  const fetch = vi.fn<FetchLike>(async () => jsonResponse({ data }));
  const client = createGitHubClient({ token: 't', apiUrl: 'https://api.github.com', fetch });
  const sent = () => fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
  return { client, sent };
}

describe('fetchReviewThreads', () => {
  it('lists open conversations, current first, with the opening and last comments', async () => {
    const { client } = setup(
      threadsResponse([
        threadNode('1', { isOutdated: true }),
        threadNode('2', { isResolved: true }),
        null,
        threadNode('3', {
          line: null,
          comments: {
            totalCount: 4,
            nodes: [null, { ...threadNode('x').comments.nodes[0], author: null }],
          },
        }),
      ]),
    );
    const { threads, complete } = await fetchReviewThreads(client, 'PR_1');
    expect(complete).toBe(true);
    expect(threads.map((t) => [t.id, t.outdated, t.line, t.commentCount])).toEqual([
      ['3', false, null, 4],
      ['1', true, 12, 1],
    ]);
    // Of four comments: the opening one, then the latest GitHub sent.
    expect(threads[0]?.comments).toEqual([
      expect.objectContaining({ author: 'alice', text: 'Why a literal here?' }),
      expect.objectContaining({ author: 'ghost', text: 'Should this be a constant?' }),
    ]);
    // A short thread is all in the latest comments: its opening is not repeated.
    expect(threads[1]?.comments.map(({ author }) => author)).toEqual(['bob']);
  });

  it('reads the next pages to find open conversations after resolved ones, up to five', async () => {
    let page = 0;
    const fetch = vi.fn<FetchLike>(async () => {
      page += 1;
      return jsonResponse({
        data: threadsResponse(
          page === 2 ? [threadNode('open')] : [threadNode(`r${page}`, { isResolved: true })],
          `c${page}`,
        ),
      });
    });
    const client = createGitHubClient({ token: 't', apiUrl: 'https://api.github.com', fetch });
    const { threads, complete } = await fetchReviewThreads(client, 'PR_1');
    expect(threads.map((thread) => thread.id)).toEqual(['open']);
    expect(complete).toBe(false);
    const afters = fetch.mock.calls.map(
      ([, init]) => JSON.parse(String(init.body)).variables.after,
    );
    expect(afters).toEqual([null, 'c1', 'c2', 'c3', 'c4']);
  });

  it('throws not_found for a node that is not a pull request', async () => {
    await expect(fetchReviewThreads(setup({ node: null }).client, 'X')).rejects.toBeInstanceOf(
      GitHubError,
    );
  });
});

describe('thread actions', () => {
  it('resolves and replies, sending the thread id and the trimmed message', async () => {
    const resolved = setup({ resolveReviewThread: { thread: { id: '1', isResolved: true } } });
    await resolveThread(resolved.client, 'T_1');
    expect(resolved.sent()[0].variables).toEqual({ id: 'T_1' });
    const replied = setup({ addPullRequestReviewThreadReply: { comment: { id: 'C' } } });
    await replyToThread(replied.client, 'T_1', '  Done  ');
    expect(replied.sent()[0].variables).toEqual({ id: 'T_1', body: 'Done' });
  });

  it('refuses an empty reply and an unconfirmed change', async () => {
    await expect(replyToThread(setup({}).client, 'T', '  ')).rejects.toThrow('Write a message');
    await expect(replyToThread(setup({}).client, 'T', 'ok')).rejects.toBeInstanceOf(GitHubError);
    await expect(resolveThread(setup({}).client, 'T')).rejects.toBeInstanceOf(GitHubError);
  });
});
