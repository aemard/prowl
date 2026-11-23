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

describe('lastHumanComment', () => {
  const at = (hour: number) => `2026-10-05T${String(hour).padStart(2, '0')}:00:00Z`;
  const by = (login: string | null, typename = 'User', hour = 10) => ({
    createdAt: at(hour),
    author: login ? { __typename: typename, login } : null,
  });
  const human = (nodes: ReturnType<typeof by>[] | null) =>
    mapPullRequest(prNode({ comments: { nodes } })).lastHumanComment;

  it.each([
    ['no comment', [], null],
    ['a person only', [by('bob')], { author: 'bob', createdAt: at(10) }],
    // A coverage report after a question must not hide it.
    [
      'a person, then bots',
      [by('bob', 'User', 9), by('codecov', 'Bot', 10), by('ci[bot]', 'User', 11)],
      { author: 'bob', createdAt: at(9) },
    ],
    ['bots only', [by('codecov', 'Bot'), by('github-actions', 'Bot')], null],
    [
      'the latest of two people',
      [by('bob', 'User', 9), by('carol', 'User', 10)],
      { author: 'carol', createdAt: at(10) },
    ],
    // A deleted account was a person.
    ['a deleted account', [by(null)], { author: 'ghost', createdAt: at(10) }],
  ])('with %s', (_, nodes, expected) => {
    expect(human(nodes)).toEqual(expected);
  });

  it('is null when GitHub could not read the comments', () => {
    expect(human(null)).toBeNull();
  });
});
