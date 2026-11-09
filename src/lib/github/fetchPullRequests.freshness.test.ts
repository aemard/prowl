import { expect, it } from 'vitest';
import { headCommit, prId, prNode, searchResponse } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../model';
import { fetchPullRequests } from './fetchPullRequests';
import { bySearch, mapped, section, settings, setup } from './fetchPullRequests.test-support';

it('reserves merge reads for old PRs despite continuous visible priority hints', async () => {
  const now = Date.now();
  const nodes = Array.from({ length: 25 }, (_, index) =>
    prNode({ number: index + 1, isDraft: index >= 20 }),
  );
  const previous = {
    pullRequests: Object.fromEntries(nodes.map((node) => [node.id, mapped(node)])),
    mergeStateAt: Object.fromEntries(
      nodes.map((node, index) => [
        node.id,
        new Date(now - (index >= 20 ? 120 : 20) * 60_000).toISOString(),
      ]),
    ),
  };
  const { client, calls } = setup({ ProwlSearch: bySearch({ 'author:@me': nodes }) });
  const result = await fetchPullRequests(
    client,
    settings(),
    previous,
    null,
    undefined,
    undefined,
    () => nodes.slice(0, 20).map(({ id }) => id),
  );
  const reads = calls
    .filter(({ operation }) => operation === 'ProwlMergeState')
    .flatMap(({ variables }) => variables.ids);
  expect(reads).toHaveLength(20);
  expect(reads).toContain(prId(21));
  expect(reads).toContain(prId(22));
  expect(result.mergeStateAt[prId(19)]).toBe(previous.mergeStateAt[prId(19)]);
  expect(result.mergeStateDue).toContain(prId(19));
});

it('bounds page requests independently of a tiny retained limit and rejected repositories', async () => {
  const nodes = Array.from({ length: 101 }, (_, index) =>
    prNode({ number: index + 1, repository: 'excluded/repo' }),
  );
  const { client, queries } = setup({
    ProwlSearch: (variables) => searchResponse(nodes, variables),
  });
  const result = await fetchPullRequests(
    client,
    settings({
      maxPerSection: 1,
      repoInclude: ['allowed/repo'],
      sections: [section('custom', { query: 'org:excluded' })],
    }),
  );
  expect(queries()).toHaveLength(20);
  expect(result.sections.custom).toEqual([]);
  expect(result.sectionCoverage?.custom?.hasMore).toBe(true);
});

it('invalidates cached readiness on changed same-head evidence, even when enrichment fails', async () => {
  const old = prNode({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' });
  const changed = { ...old, commits: headCommit({ FAILURE: 1 }) };
  const { client } = setup({
    ProwlSearch: bySearch({ 'author:@me': [changed] }),
    ProwlMergeState: () => jsonResponse({ message: 'Bad gateway' }, { status: 502 }),
  });
  const published: Array<PullRequest | undefined> = [];
  const result = await fetchPullRequests(
    client,
    settings(),
    {
      pullRequests: { [old.id]: mapped(old) },
      mergeStateAt: { [old.id]: new Date().toISOString() },
    },
    null,
    undefined,
    async (snapshot) => {
      published.push(snapshot.pullRequests[old.id]);
    },
  );
  for (const pr of [...published, result.pullRequests[old.id]]) {
    expect(pr?.mergeStateStatus).toBe('unknown');
    expect(pr?.reviewDecision).toBe('unknown');
  }
  expect(result.mergeStateDue).toContain(old.id);
  expect(result.mergeStateAt[old.id]).toBeUndefined();
});

it('never lets an errored section fallback overwrite a newer PR from another section', async () => {
  const old = prNode();
  const fresh = prNode({ headRefOid: 'b'.repeat(40) });
  const { client } = setup({
    ProwlSearch: (variables) =>
      String(variables.query).includes('user-review-requested')
        ? jsonResponse({ message: 'Bad gateway' }, { status: 502 })
        : searchResponse([fresh], variables),
  });
  const result = await fetchPullRequests(
    client,
    settings({ sections: [section('authored'), section('review_requested')] }),
    {
      pullRequests: { [old.id]: mapped(old) },
      sections: { authored: [old.id], review_requested: [old.id] },
    },
  );
  expect(result.sections.review_requested).toContain(old.id);
  expect(result.pullRequests[old.id]?.headSha).toBe(fresh.headRefOid);
});
