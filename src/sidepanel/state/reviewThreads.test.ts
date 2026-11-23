import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { threadNode, threadsResponse } from '../../../tests/fixtures/threads';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { loadThreads, reviewThreads, threadsStale } from './reviewThreads';
import { auth } from './store';

const pr = buildPullRequest({ unresolvedThreads: 1 });
const answer = vi.fn(async (): Promise<Response> => jsonResponse({ data: threadsResponse([]) }));

describe('loadThreads', () => {
  beforeEach(() => {
    auth.value = buildAuth();
    vi.stubGlobal('fetch', answer);
  });
  afterEach(() => {
    reviewThreads.value = {};
    auth.value = undefined;
    answer.mockReset();
    vi.unstubAllGlobals();
  });

  it('is keyed to the update GitHub had when it answered, so the poll after a reply reads nothing', async () => {
    const replied = '2026-10-06T11:00:00.000Z';
    answer.mockResolvedValueOnce(jsonResponse({ data: threadsResponse([], null, replied) }));
    await loadThreads(pr);
    const entry = reviewThreads.value[pr.id];
    expect(entry?.key).toBe(replied);
    // The poll brings the reply's own `updatedAt`: nothing to read again; a later one is.
    expect(threadsStale(entry, { ...pr, updatedAt: replied })).toBe(false);
    expect(threadsStale(entry, pr)).toBe(false);
    expect(threadsStale(entry, { ...pr, updatedAt: '2026-10-06T12:00:00.000Z' })).toBe(true);
  });

  it('does nothing while signed out', async () => {
    auth.value = undefined;
    await loadThreads(pr);
    expect(reviewThreads.value).toEqual({});
    expect(answer).not.toHaveBeenCalled();
  });

  it('keeps the previous list on screen while it reloads, then replaces it', async () => {
    answer.mockResolvedValueOnce(jsonResponse({ data: threadsResponse([threadNode('1')]) }));
    await loadThreads(pr);
    let release: (response: Response) => void = () => {};
    answer.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const reloading = loadThreads(pr);
    expect(reviewThreads.value[pr.id]).toMatchObject({ loading: true, threads: [{ id: '1' }] });
    release(jsonResponse({ data: threadsResponse([]) }));
    await reloading;
    expect(reviewThreads.value[pr.id]).toEqual({
      key: pr.updatedAt,
      loading: false,
      threads: [],
      complete: true,
    });
  });

  it('publishes only the latest of two requests', async () => {
    let first: (response: Response) => void = () => {};
    answer.mockImplementationOnce(() => new Promise((resolve) => (first = resolve)));
    const older = loadThreads(pr);
    answer.mockResolvedValueOnce(jsonResponse({ data: threadsResponse([threadNode('2')]) }));
    await loadThreads(pr);
    first(jsonResponse({ data: threadsResponse([threadNode('1')]) }));
    await older;
    expect(reviewThreads.value[pr.id]?.threads?.map((thread) => thread.id)).toEqual(['2']);
  });

  it('forgets every list when another account signs in', async () => {
    answer.mockResolvedValueOnce(jsonResponse({ data: threadsResponse([threadNode('1')]) }));
    await loadThreads(pr);
    auth.value = { ...buildAuth(), token: 'ghp_other' };
    expect(reviewThreads.value).toEqual({});
  });

  it("keeps the previous list after a failure, with GitHub's reason", async () => {
    answer.mockResolvedValueOnce(jsonResponse({ data: threadsResponse([threadNode('1')]) }));
    await loadThreads(pr);
    answer.mockResolvedValueOnce(jsonResponse({ data: { node: null } }));
    await loadThreads(pr);
    expect(reviewThreads.value[pr.id]).toMatchObject({
      loading: false,
      threads: [{ id: '1' }],
      error: 'Could not load the conversations: This pull request is not available.',
    });
  });

  it('words an unexpected failure generically', async () => {
    // A thread without its comments connection: mapping it throws a bug, not a GitHubError.
    answer.mockResolvedValueOnce(
      jsonResponse({ data: threadsResponse([{ id: 'x', isResolved: false, comments: null }]) }),
    );
    await loadThreads(pr);
    expect(reviewThreads.value[pr.id]?.error).toBe(
      'Could not load the conversations: Something went wrong.',
    );
    expect(reviewThreads.value[pr.id]?.threads).toBeUndefined();
  });

  it('drops an answer that arrives after another account signed in', async () => {
    let release: (response: Response) => void = () => {};
    answer.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const loading = loadThreads(pr);
    auth.value = { ...buildAuth(), token: 'ghp_other' };
    release(jsonResponse({ data: threadsResponse([threadNode('1')]) }));
    await loading;
    // The new account starts from nothing, and the old answer does not land in it.
    expect(reviewThreads.value).toEqual({});
  });
});
