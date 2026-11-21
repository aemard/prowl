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
    expect(text.discussion).toBe(
      'Improve widget\n\nMakes the widget faster.\n\nbob (comment): Can you add a test?\n\ncarol (review, approved): LGTM',
    );
    expect(text.failures).toBe(
      'test\n1 test failed\nwidget.test.ts failed\n- src/widget.ts:12: expected 2, got 3\n\nci/circle: ERROR',
    );
  });

  it('skips empty comments, names deleted authors and caps long text', () => {
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
    expect(text.discussion.length).toBeLessThanOrEqual(12_001);
    expect(text.discussion).toContain('ghost (comment): hi');
    expect(text.failures).toBe('');
  });

  it('throws not_found when the pull request is gone', async () => {
    await expect(fetchPullRequestText(client(null), 'PR_1')).rejects.toBeInstanceOf(GitHubError);
  });
});
