import { expect, it } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { rerunFailedChecks } from './actions';
import { createGitHubClient } from './client';

it('reads every check-suite page before restarting failed runs', async () => {
  let reads = 0;
  const operations: string[] = [];
  const client = createGitHubClient({
    token: 'test',
    apiUrl: 'https://api.github.com',
    fetch: async (url) => {
      if (new URL(url).pathname === '/graphql') {
        reads++;
        operations.push('read');
        return jsonResponse({
          data: {
            node: {
              headRefOid: 'a',
              repository: { owner: { login: 'acme' }, name: 'web' },
              commits: {
                nodes: [
                  {
                    commit: {
                      checkSuites: {
                        nodes: [
                          {
                            databaseId: reads,
                            conclusion: 'FAILURE',
                            workflowRun: { databaseId: reads },
                          },
                        ],
                        pageInfo: {
                          hasNextPage: reads === 1,
                          endCursor: reads === 1 ? 'next' : null,
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        });
      }
      operations.push('restart');
      return new Response(null, { status: 201 });
    },
  });
  await expect(rerunFailedChecks(client, 'PR_1')).resolves.toBe(2);
  expect(operations).toEqual(['read', 'read', 'restart', 'restart']);
});

it.each(['repeated', 'missing', 'cap', 'head'])(
  'does not restart an incomplete or stale suite list (%s)',
  async (mode) => {
    let reads = 0;
    let restarts = 0;
    const client = createGitHubClient({
      token: 'test',
      apiUrl: 'https://api.github.com',
      fetch: async (url) => {
        if (new URL(url).pathname === '/graphql') {
          reads++;
          return jsonResponse({
            data: {
              node: {
                headRefOid: mode === 'head' && reads > 1 ? 'b' : 'a',
                repository: { owner: { login: 'acme' }, name: 'web' },
                commits: {
                  nodes: [
                    {
                      commit: {
                        checkSuites: {
                          nodes: [{ databaseId: reads, conclusion: 'FAILURE', workflowRun: null }],
                          pageInfo: {
                            hasNextPage: true,
                            endCursor:
                              mode === 'missing'
                                ? null
                                : mode === 'repeated'
                                  ? 'same'
                                  : String(reads),
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          });
        }
        restarts++;
        return new Response(null, { status: 201 });
      },
    });
    await expect(rerunFailedChecks(client, 'PR_1')).rejects.toHaveProperty('kind', 'validation');
    expect(restarts).toBe(0);
    expect(reads).toBeLessThanOrEqual(5);
  },
);
