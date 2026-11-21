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
  it('lists open conversations, current first, with their last comments', async () => {
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
    const threads = await fetchReviewThreads(client, 'PR_1');
    expect(threads.map((t) => [t.id, t.outdated, t.line, t.commentCount])).toEqual([
      ['3', false, null, 4],
      ['1', true, 12, 1],
    ]);
    expect(threads[0]?.comments).toEqual([
      expect.objectContaining({ author: 'ghost', text: 'Should this be a constant?' }),
    ]);
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
