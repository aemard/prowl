import { describe, expect, it } from 'vitest';
import { prNode, searchResponse } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import { fetchPullRequests } from './fetchPullRequests';
import { section, settings, setup } from './fetchPullRequests.test-support';
import { SEARCH_QUERY, TEAM_SEARCH_QUERY, withoutStacks } from './queries';

/** What GitHub answers a query that selects a field its schema no longer has. */
const undefinedField = () =>
  jsonResponse({
    errors: [
      {
        message: "Field 'stackEntry' doesn't exist on type 'PullRequest'",
        extensions: { code: 'undefinedField', typeName: 'PullRequest', fieldName: 'stackEntry' },
      },
    ],
  });

describe('searches when GitHub drops stacks', () => {
  it('strips only the stack selection', () => {
    expect(SEARCH_QUERY).toContain('stackEntry');
    expect(withoutStacks(SEARCH_QUERY)).not.toContain('stackEntry');
    expect(withoutStacks(TEAM_SEARCH_QUERY)).toContain('... on Team');
    expect(withoutStacks(SEARCH_QUERY).length).toBeLessThan(SEARCH_QUERY.length);
  });

  it('reads every section without stacks instead of failing them', async () => {
    const pr = prNode({ number: 1 });
    const { client, searchTexts } = setup({
      ProwlSearch: (v) => (searchTexts.length === 1 ? undefinedField() : searchResponse([pr], v)),
    });
    const result = await fetchPullRequests(
      client,
      settings({ sections: [section('authored'), section('review_requested')] }),
      null,
    );
    expect(result.sections).toEqual({ authored: [pr.id], review_requested: [pr.id] });
    expect(result.sectionErrors).toEqual({});
    expect(result.pullRequests[pr.id]?.stack).toBeUndefined();
    // One refused request, then every search goes on without the field.
    expect(searchTexts.map((query) => query.includes('stackEntry'))).toEqual([true, false, false]);
  });

  it('keeps Team fields when the refusal is about stacks', async () => {
    const pr = prNode({ number: 2 });
    const { client, searchTexts } = setup({
      ProwlSearch: (v) => (searchTexts.length === 1 ? undefinedField() : searchResponse([pr], v)),
    });
    await fetchPullRequests(
      client,
      settings({ sections: [section('team_review_requested')] }),
      null,
      { teams: [{ org: 'acme', slug: 'core', name: 'core' }], error: null },
    );
    const retry = searchTexts[1] ?? '';
    expect(retry).toContain('... on Team');
    expect(retry).not.toContain('stackEntry');
  });

  it('still fails on other GraphQL errors', async () => {
    const { client } = setup({
      ProwlSearch: () => jsonResponse({ errors: [{ message: "Field 'title' doesn't exist" }] }),
    });
    const result = await fetchPullRequests(client, settings(), null);
    expect(result.sectionErrors.authored).toContain('title');
  });
});
