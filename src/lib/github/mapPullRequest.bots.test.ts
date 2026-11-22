import { describe, expect, it } from 'vitest';
import { prNode, reviewNode } from '../../../tests/fixtures/github';
import { mapPullRequest } from './mapPullRequest';

const author = (login: string, __typename: string) =>
  mapPullRequest(prNode({ author: { __typename, login, avatarUrl: 'a' } })).author;

describe('isBot', () => {
  it.each([
    // GraphQL: the type says it, the login has no suffix.
    ['Bot', 'dependabot', true],
    // The suffix says it on its own, as REST spells bot logins.
    ['User', 'renovate[bot]', true],
    ['Bot', 'renovate[bot]', true],
    ['User', 'octocat', false],
    // A person who happens to be called like a bot is not one.
    ['User', 'bot', false],
    ['Mannequin', 'dependabot-fan', false],
    ['Organization', 'acme', false],
  ])('of the author is %s %s -> %s', (typename, login, isBot) => {
    expect(author(login, typename)).toEqual({ login, avatarUrl: 'a', isBot });
  });

  it('is absent with the author of a deleted account', () => {
    expect(mapPullRequest(prNode({ author: null })).author).toBeNull();
  });

  it('is read from the type of review and comment authors', () => {
    const pr = mapPullRequest(
      prNode({
        latestReviews: {
          nodes: [
            {
              ...reviewNode('copilot', 'COMMENTED'),
              author: { __typename: 'Bot', login: 'copilot' },
            },
            reviewNode('talbot', 'APPROVED', '2026-10-04T10:00:00Z'),
            reviewNode(null, 'COMMENTED', '2026-10-03T10:00:00Z'),
          ],
        },
        comments: {
          nodes: [
            {
              createdAt: '2026-10-05T11:00:00Z',
              author: { __typename: 'Bot', login: 'coderabbitai' },
            },
          ],
        },
      }),
    );
    expect(pr.reviews.map(({ author, isBot }) => [author, isBot])).toEqual([
      ['copilot', true],
      ['talbot', false],
      ['ghost', false],
    ]);
    expect(pr.lastComment).toEqual({
      author: 'coderabbitai',
      isBot: true,
      createdAt: '2026-10-05T11:00:00Z',
    });
  });
});
