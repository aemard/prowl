import { describe, expect, it } from 'vitest';
import { buildPullRequest, buildSnapshotOf } from '../../test/panel';
import { retainDepartingCards } from './cardTransitions';

describe('departing card retention', () => {
  it('keeps a merged card in its old section and sort position until it can animate out', () => {
    const pr = buildPullRequest();
    const previous = buildSnapshotOf({ authored: [pr] });
    const merged = { ...pr, state: 'merged' as const, updatedAt: '2026-11-03T21:00:00Z' };
    const next = buildSnapshotOf({ authored: [] }, { pullRequests: { [pr.id]: merged } });
    const visible = retainDepartingCards(previous, next, { [pr.id]: 'merged' });
    expect(visible.sections.authored).toEqual([pr.id]);
    expect(visible.pullRequests[pr.id]).toMatchObject({ state: 'merged', updatedAt: pr.updatedAt });
    expect(next.sections.authored).toEqual([]);
    expect(next.pullRequests[pr.id]?.updatedAt).toBe(merged.updatedAt);
  });

  it('does not reinsert a departing card into a section removed by settings', () => {
    const pr = buildPullRequest();
    const previous = buildSnapshotOf({ authored: [pr] });
    const next = buildSnapshotOf({});
    expect(retainDepartingCards(previous, next, { [pr.id]: 'closed' }).sections).toEqual({});
  });
});
