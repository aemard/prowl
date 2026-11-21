import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';
import { mergeStackUpTo } from './stackMerge';

const top = {
  repo: { owner: 'acme', name: 'web', nameWithOwner: 'acme/web' },
  number: 2472,
  headSha: 'abc',
};
const PATH = 'https://api.github.com/repos/acme/web/pulls/2472/merge-async';

function setup(...answers: Response[]) {
  const fetch = vi.fn<FetchLike>(async () => answers.shift() ?? jsonResponse({}, { status: 500 }));
  const client = createGitHubClient({ token: 't', apiUrl: 'https://api.github.com', fetch });
  const sent = () =>
    fetch.mock.calls.map(([url, init]) => [
      init.method,
      String(url),
      init.body && JSON.parse(String(init.body)),
    ]);
  return { client, sent };
}
const wait = async () => {};

describe('mergeStackUpTo', () => {
  it('merges up to the pull request, pinned to its head, and follows the operation', async () => {
    const { client, sent } = setup(
      jsonResponse({ status: 'pending', details: { uuid: 'u-1' } }, { status: 202 }),
      jsonResponse({ status: 'pending', details: { uuid: 'u-1' } }),
      jsonResponse({ status: 'merged' }),
    );
    await expect(
      mergeStackUpTo(client, top, { method: 'squash', queue: false }, wait),
    ).resolves.toBe('merged');
    expect(sent()).toEqual([
      ['PUT', PATH, { sha: 'abc', merge_action: 'direct_merge', merge_method: 'squash' }],
      ['GET', `${PATH}/u-1`, undefined],
      ['GET', `${PATH}/u-1`, undefined],
    ]);
  });

  it('queues without a method, and reports a stack already queued', async () => {
    const { client, sent } = setup(jsonResponse({ status: 'enqueued' }));
    await expect(mergeStackUpTo(client, top, { method: 'merge', queue: true }, wait)).resolves.toBe(
      'enqueued',
    );
    expect(sent()[0]?.[2]).toEqual({ sha: 'abc', merge_action: 'merge_queue' });
  });

  it("throws GitHub's reason when the merge fails, and gives up waiting after a minute", async () => {
    const failed = setup(
      jsonResponse({ status: 'pending', details: { uuid: 'u' } }, { status: 202 }),
      jsonResponse({
        status: 'failed',
        details: { message: 'Required status check "test" failed' },
      }),
    );
    await expect(
      mergeStackUpTo(failed.client, top, { method: 'merge', queue: false }, wait),
    ).rejects.toThrow('Required status check "test" failed');
    const pending = jsonResponse({ status: 'pending', details: { uuid: 'u' } });
    const slow = setup(...Array.from({ length: 40 }, () => pending.clone()));
    await expect(
      mergeStackUpTo(slow.client, top, { method: 'merge', queue: false }, wait),
    ).resolves.toBe('pending');
    await expect(
      mergeStackUpTo(setup(jsonResponse({})).client, top, { method: 'merge', queue: false }, wait),
    ).rejects.toBeInstanceOf(GitHubError);
  });
});
