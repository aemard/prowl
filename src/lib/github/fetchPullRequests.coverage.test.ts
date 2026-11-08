import { describe, expect, it } from 'vitest';
import {
  closedNode,
  nodesResponse,
  prId,
  prNode,
  searchResponse,
} from '../../../tests/fixtures/github';
import { graphqlError, graphqlRateLimit, jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../model';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, section, settings, setup } from './fetchPullRequests.test-support';

describe('bounded and partial section coverage', () => {
  it.each([49, 50, 51])('reports extra results only when GitHub has more (%s)', async (count) => {
    const nodes = Array.from({ length: count }, (_, i) => prNode({ number: i + 1 }));
    const { client } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
    const result = await fetchPullRequests(client, settings());
    expect(result.sections.authored?.length).toBe(Math.min(count, 50));
    expect(result.sectionCoverage?.authored?.hasMore ?? false).toBe(count > 50);
    if (count > 50)
      expect(result.sectionCoverage?.authored?.queries[0]).toMatchObject({
        cursor: '50',
        total: 51,
      });
  });

  it('looks beyond rejected repository pages, under a separate scan budget', async () => {
    const nodes = Array.from({ length: 51 }, (_, i) =>
      prNode({ number: i + 1, repository: i === 50 ? 'allowed/repo' : 'elsewhere/repo' }),
    );
    const { client, queries } = setup({
      ProwlSearch: (variables) => searchResponse(nodes, variables),
    });
    const result = await fetchPullRequests(
      client,
      settings({
        sections: [section('custom', { query: 'org:elsewhere org:allowed is:open' })],
        repoInclude: ['allowed/repo'],
      }),
    );
    expect(result.sections.custom).toEqual([prId(51, 'allowed/repo')]);
    expect(queries().length).toBe(3);
  });

  it('keeps fetched pages and previous section members when a subsequent page fails', async () => {
    const nodes = Array.from({ length: 26 }, (_, i) => prNode({ number: i + 1 }));
    const old = prNode({ number: 99 });
    const { client } = setup({
      ProwlSearch: (variables) =>
        variables.after
          ? jsonResponse({ message: 'Bad gateway' }, { status: 502 })
          : searchResponse(nodes, variables),
    });
    const result = await fetchPullRequests(client, settings(), {
      pullRequests: { [old.id]: mapped(old) },
      sections: { authored: [old.id] },
    });
    expect(result.sections.authored).toHaveLength(26);
    expect(result.sections.authored).toContain(old.id);
    expect(result.sectionCoverage?.authored).toMatchObject({
      partial: true,
      stale: true,
      hasMore: true,
    });
    expect(result.sectionErrors.authored).toContain('Bad gateway');
  });

  it('reports non-SAML node errors and their field path rather than a complete empty result', async () => {
    const data = searchResponse([null]);
    const { client } = setup({
      ProwlSearch: () =>
        jsonResponse({
          data,
          errors: [
            graphqlError('FORBIDDEN', 'Resource not accessible by personal access token', [
              'search',
              'nodes',
              0,
            ]),
          ],
        }),
    });
    const result = await fetchPullRequests(client, settings());
    expect(result.sectionCoverage?.authored?.partial).toBe(true);
    expect(result.sectionErrors.authored).toContain('Resource not accessible');
    expect(result.sectionErrors.authored).toContain('search.nodes.0');
  });

  it('does not let a failed section overwrite the fresh copy another section loaded', async () => {
    const [old, fresh] = [prNode({ title: 'Old' }), prNode({ title: 'Fresh' })];
    const { client } = setup({
      ProwlSearch: (variables) =>
        String(variables.query).includes('mentions:')
          ? jsonResponse({ message: 'Bad gateway' }, { status: 502 })
          : searchResponse([fresh], variables),
    });
    const result = await fetchPullRequests(
      client,
      settings({ sections: [section('authored'), section('mentioned')] }),
      { pullRequests: { [old.id]: mapped(old) }, sections: { mentioned: [old.id] } },
    );
    expect(result.sections).toEqual({ authored: [fresh.id], mentioned: [fresh.id] });
    expect(result.pullRequests[fresh.id]?.title).toBe('Fresh');
  });

  it('does not keep PRs that left a search which only had unreadable nodes', async () => {
    const [kept, gone] = [prNode({ number: 1 }), prNode({ number: 2 })];
    const { client } = setup({
      ProwlSearch: (variables) =>
        jsonResponse({
          data: searchResponse([null, kept], variables),
          errors: [graphqlError('FORBIDDEN', 'SAML enforcement', ['search', 'nodes', 0])],
        }),
      ProwlNodes: ({ ids }) => nodesResponse(ids, [closedNode(gone.id, { state: 'CLOSED' })]),
    });
    const result = await fetchPullRequests(client, settings(), {
      pullRequests: { [gone.id]: mapped(gone) },
      sections: { authored: [gone.id] },
    });
    expect(result.sections.authored).toEqual([kept.id]);
    expect(result.pullRequests[gone.id]?.state).toBe('closed');
    expect(result.sectionCoverage?.authored).toMatchObject({ partial: true });
    expect(result.sectionCoverage?.authored?.stale).toBeUndefined();
  });

  it('stops at a cursor that does not advance and keeps the cached members, closed ones too', async () => {
    const loaded = prNode({ number: 1 });
    const cached: PullRequest = { ...mapped(prNode({ number: 2 })), state: 'merged' };
    const { client } = setup({
      ProwlSearch: () => ({
        search: {
          issueCount: 99,
          pageInfo: { hasNextPage: true, endCursor: null },
          nodes: [loaded],
        },
        rateLimit: graphqlRateLimit(),
      }),
    });
    const result = await fetchPullRequests(
      client,
      settings({ sections: [section('custom', { query: 'is:merged' })] }),
      { pullRequests: { [cached.id]: cached }, sections: { custom: [cached.id] } },
    );
    expect(result.sections.custom).toEqual([loaded.id, cached.id]);
    expect(result.sectionErrors.custom).toBe('GitHub did not provide a usable next-page cursor.');
    expect(result.sectionCoverage?.custom).toMatchObject({
      hasMore: true,
      partial: true,
      stale: true,
    });
  });

  it('publishes a completed section before the next search starts, keeping the pending one cached', async () => {
    const [mine, cached] = [prNode({ number: 1 }), prNode({ number: 2 })];
    const publications: unknown[] = [];
    const { client } = setup({
      ProwlSearch: (variables) => {
        if (String(variables.query).includes('mentions:')) {
          expect(publications).toEqual([
            {
              sections: { authored: [mine.id], mentioned: [cached.id] },
              pending: ['mentioned'],
              cards: [mine.id, cached.id],
            },
          ]);
          return searchResponse([], variables);
        }
        return searchResponse([mine], variables);
      },
      ProwlNodes: ({ ids }) => nodesResponse(ids, [closedNode(cached.id, { state: 'OPEN' })]),
    });
    const result = await fetchPullRequests(
      client,
      settings({ sections: [section('authored'), section('mentioned')] }),
      { pullRequests: { [cached.id]: mapped(cached) }, sections: { mentioned: [cached.id] } },
      null,
      undefined,
      async ({ sections, sectionsPending, pullRequests }) => {
        publications.push({
          sections: { ...sections },
          pending: sectionsPending && [...sectionsPending],
          cards: Object.keys(pullRequests),
        });
      },
    );
    expect(result.sections).toEqual({ authored: [mine.id], mentioned: [] });
    expect(result.sectionsPending).toBeUndefined();
  });
});
