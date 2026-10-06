import { describe, expect, it, vi } from 'vitest';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import {
  APPROVE_MUTATION,
  approve,
  COMMENT_MUTATION,
  comment,
  MAX_BODY_LENGTH,
  REQUEST_CHANGES_MUTATION,
  requestChanges,
} from './actions';
import { createGitHubClient, type FetchLike } from './client';
import { GitHubError } from './errors';

const reviewed = { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } };
const commented = { addComment: { commentEdge: { node: { id: 'IC_1' } } } };

/** A client whose fetch answers with `answer`; `sent` holds every GraphQL request body. */
function setup(answer: Response | object) {
  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  const fetch = vi.fn<FetchLike>(async (_url, init) => {
    sent.push(JSON.parse(String(init.body)));
    return answer instanceof Response ? answer : jsonResponse({ data: answer });
  });
  const client = createGitHubClient({
    token: 'ghp_secret',
    apiUrl: 'https://api.github.com',
    fetch,
  });
  return { client, sent };
}

describe('approve', () => {
  it('sends the named mutation with the APPROVE event and no body by default', async () => {
    const { client, sent } = setup(reviewed);
    await approve(client, 'PR_1');
    expect(sent).toEqual([
      { query: APPROVE_MUTATION, variables: { id: 'PR_1', event: 'APPROVE' } },
    ]);
    expect(APPROVE_MUTATION).toContain('mutation ProwlApprove(');
    expect(APPROVE_MUTATION).toContain('addPullRequestReview');
  });

  it('adds a trimmed note, and ignores a blank one', async () => {
    const { client, sent } = setup(reviewed);
    await approve(client, 'PR_1', '  Looks good  ');
    await approve(client, 'PR_1', '   ');
    expect(sent.map((request) => request.variables)).toEqual([
      { id: 'PR_1', event: 'APPROVE', body: 'Looks good' },
      { id: 'PR_1', event: 'APPROVE' },
    ]);
  });

  it('does not report success when GitHub confirms nothing', async () => {
    const { client } = setup({ addPullRequestReview: null });
    await expect(approve(client, 'PR_1')).rejects.toMatchObject({
      kind: 'server',
      message: 'GitHub did not confirm the review.',
    });
    const empty = setup({ addPullRequestReview: { pullRequestReview: null } });
    await expect(approve(empty.client, 'PR_1')).rejects.toBeInstanceOf(GitHubError);
  });

  it("surfaces GitHub's own message, without the token", async () => {
    const { client } = setup(
      jsonResponse({
        data: null,
        errors: [graphqlError('UNPROCESSABLE', 'Can not approve your own pull request ghp_secret')],
      }),
    );
    const error = await approve(client, 'PR_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({
      kind: 'validation',
      message: 'Can not approve your own pull request [redacted]',
    });
  });

  it('classifies a failing request like any other call', async () => {
    const { client } = setup(jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    await expect(approve(client, 'PR_1')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('requestChanges', () => {
  it('sends the REQUEST_CHANGES event with the trimmed message', async () => {
    const { client, sent } = setup(reviewed);
    await requestChanges(client, 'PR_1', '\n  Please add a test.  ');
    expect(sent).toEqual([
      {
        query: REQUEST_CHANGES_MUTATION,
        variables: { id: 'PR_1', event: 'REQUEST_CHANGES', body: 'Please add a test.' },
      },
    ]);
    expect(REQUEST_CHANGES_MUTATION).toContain('mutation ProwlRequestChanges(');
  });

  it('needs a message and sends nothing without one', async () => {
    const { client, sent } = setup(reviewed);
    for (const body of ['', '  \n ']) {
      await expect(requestChanges(client, 'PR_1', body)).rejects.toMatchObject({
        kind: 'validation',
        message: 'Write a message first.',
      });
    }
    expect(sent).toEqual([]);
  });

  it('refuses a message GitHub would refuse', async () => {
    const { client, sent } = setup(reviewed);
    await expect(
      requestChanges(client, 'PR_1', 'x'.repeat(MAX_BODY_LENGTH + 1)),
    ).rejects.toMatchObject({ kind: 'validation' });
    await requestChanges(client, 'PR_1', 'x'.repeat(MAX_BODY_LENGTH));
    expect(sent).toHaveLength(1);
  });

  it('does not report success when GitHub confirms nothing', async () => {
    const { client } = setup({ addPullRequestReview: null });
    await expect(requestChanges(client, 'PR_1', 'No')).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('comment', () => {
  it('adds a conversation comment to the pull request', async () => {
    const { client, sent } = setup(commented);
    await comment(client, 'PR_1', ' Thanks! ');
    expect(sent).toEqual([{ query: COMMENT_MUTATION, variables: { id: 'PR_1', body: 'Thanks!' } }]);
    expect(COMMENT_MUTATION).toContain('mutation ProwlComment(');
    expect(COMMENT_MUTATION).toContain('addComment');
  });

  it('needs a message and sends nothing without one', async () => {
    const { client, sent } = setup(commented);
    await expect(comment(client, 'PR_1', '   ')).rejects.toMatchObject({ kind: 'validation' });
    expect(sent).toEqual([]);
  });

  it('does not report success when GitHub confirms nothing', async () => {
    for (const data of [
      { addComment: null },
      { addComment: { commentEdge: null } },
      { addComment: { commentEdge: { node: null } } },
    ]) {
      await expect(comment(setup(data).client, 'PR_1', 'Hi')).rejects.toMatchObject({
        kind: 'server',
        message: 'GitHub did not confirm the comment.',
      });
    }
  });

  it('fails with a network error when GitHub cannot be reached', async () => {
    const client = createGitHubClient({
      token: 'ghp_secret',
      apiUrl: 'https://api.github.com',
      fetch: async () => {
        throw new TypeError('offline ghp_secret');
      },
    });
    const error = await comment(client, 'PR_1', 'Hi').catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'network', message: 'Could not reach GitHub.' });
  });
});
