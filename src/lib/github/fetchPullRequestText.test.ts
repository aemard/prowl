import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { failingRunText, textNode } from '../../../tests/fixtures/text';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';
import { fetchPullRequestText, mapPullRequestText } from './fetchPullRequestText';

const client = (node: unknown) =>
  createGitHubClient({
    token: 't',
    apiUrl: 'https://api.github.com',
    fetch: vi.fn<FetchLike>(async () => jsonResponse({ data: { node } })),
  });

describe('fetchPullRequestText', () => {
  it('lays out the conversation and the reports of failing checks only', async () => {
    const text = await fetchPullRequestText(
      client(
        textNode({}, [
          failingRunText(),
          { ...failingRunText('lint'), conclusion: 'SUCCESS' },
          { __typename: 'StatusContext', context: 'ci/circle', state: 'ERROR', description: null },
          { __typename: 'StatusContext', context: 'ok', state: 'SUCCESS', description: 'fine' },
          null,
        ]),
      ),
      'PR_1',
    );
    expect(text.description).toBe('Improve widget\n\nMakes the widget faster.');
    expect(text.discussion).toEqual([
      'bob (comment): Can you add a test?',
      'carol (review, approved): LGTM',
    ]);
    expect(text.failures).toEqual([
      'test\n1 test failed\nwidget.test.ts failed\n- src/widget.ts:12: expected 2, got 3',
      'ci/circle: ERROR',
    ]);
  });

  it('interleaves comments and reviews by date, oldest first', () => {
    const text = mapPullRequestText(
      textNode({
        comments: {
          nodes: [
            { author: { login: 'bob' }, bodyText: 'first', createdAt: '2026-11-01T00:00:00Z' },
            { author: { login: 'bob' }, bodyText: 'third', createdAt: '2026-11-03T00:00:00Z' },
          ],
        },
        reviews: {
          nodes: [
            {
              author: { login: 'carol' },
              state: 'COMMENTED',
              bodyText: 'second',
              createdAt: '2026-11-02T00:00:00Z',
            },
          ],
        },
      }),
    );
    expect(text.discussion).toEqual([
      'bob (comment): first',
      'carol (review, commented): second',
      'bob (comment): third',
    ]);
  });

  it('skips empty comments, names deleted authors and clips long text', () => {
    const text = mapPullRequestText(
      textNode({
        bodyText: 'x'.repeat(20_000),
        comments: {
          nodes: [
            { author: null, bodyText: 'hi' },
            { author: null, bodyText: ' ' },
          ],
        },
        reviews: null,
        commits: null,
      }),
    );
    expect(text.description.length).toBeLessThanOrEqual(3_001 + 'Improve widget\n\n'.length);
    expect(text.discussion).toEqual(['ghost (comment): hi']);
    expect(text.failures).toEqual([]);
  });

  it('throws not_found when the pull request is gone', async () => {
    await expect(fetchPullRequestText(client(null), 'PR_1')).rejects.toBeInstanceOf(GitHubError);
  });
});
