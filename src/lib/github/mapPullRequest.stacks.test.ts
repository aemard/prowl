import { describe, expect, it } from 'vitest';
import { prNode } from '../../../tests/fixtures/github';
import { mapPullRequest } from './mapPullRequest';

describe('mapPullRequest stacks', () => {
  it("reads GitHub's stack membership, and nothing outside a stack", () => {
    const stacked = mapPullRequest(
      prNode({
        stackEntry: {
          position: 2,
          stack: { id: 'PRS_7', number: 7, size: 10, baseRefName: 'main' },
        },
      }),
    );
    expect(stacked.stack).toEqual({ id: 'PRS_7', number: 7, size: 10, position: 2, base: 'main' });
    expect(mapPullRequest(prNode()).stack).toBeUndefined();
    expect(
      mapPullRequest(prNode({ stackEntry: { position: 1, stack: null } })).stack,
    ).toBeUndefined();
  });

  it("reads where the stack's open part starts from its entries, only when all are listed", () => {
    const entries = (states: (string | null)[], totalCount = states.length) => ({
      totalCount,
      nodes: states.map((state, index) => ({
        position: index + 1,
        pullRequest: state ? { state } : null,
      })),
    });
    const read = (stackEntries: ReturnType<typeof entries>) =>
      mapPullRequest(
        prNode({
          stackEntry: {
            position: 2,
            stack: { id: 'S', number: 7, size: 3, baseRefName: 'main', entries: stackEntries },
          },
        }),
      ).stack;
    expect(read(entries(['MERGED', 'OPEN', 'OPEN']))).toMatchObject({ open: 2, bottom: 2 });
    // A pull request the token cannot see may still be open: it holds the bottom.
    expect(read(entries([null, 'OPEN', 'CLOSED']))).toMatchObject({ open: 2, bottom: 1 });
    const cut = read(entries(['OPEN', 'OPEN'], 30));
    expect(cut?.bottom).toBeUndefined();
    expect(cut?.open).toBeUndefined();
  });
});
