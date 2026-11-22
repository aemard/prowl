import { describe, expect, it } from 'vitest';
import { buildPullRequest } from '../test/panel';
import type { PullRequest } from './model';
import { listItems, stackMembers, stackState, stackSummary } from './stacks';

const member = (position: number, overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({
    number: 100 + position,
    stack: { id: 'S7', number: 7, size: 4, position, base: 'main' },
    ...overrides,
  });
const ready = { mergeStateStatus: 'clean', reviewDecision: 'approved' } as const;
const failing = {
  state: 'failure',
  total: 1,
  passed: 0,
  failed: 1,
  pending: 0,
  neutral: 0,
} as const;

describe('listItems', () => {
  it('groups the members of a GitHub stack where the first one appears, bottom first', () => {
    const lone = buildPullRequest({ number: 1 });
    const chained = buildPullRequest({ number: 2, baseRefName: 'feature-1' });
    const items = listItems([member(3), lone, member(1), chained, member(2)]);
    expect(
      items.map((item) =>
        item.kind === 'pr' ? item.pr.number : item.members.map((m) => m.number),
      ),
    ).toEqual([[101, 102, 103], 1, 2]);
  });
});

describe('stackSummary', () => {
  it('counts each state and finds the ready run from the bottom', () => {
    const members = [
      member(1, ready),
      member(2, ready),
      member(3, { checks: failing }),
      member(4, { ...ready }),
    ];
    expect(stackSummary(members)).toEqual({
      counts: { ready: 3, progress: 0, blocked: 1, draft: 0 },
      mergeable: members.slice(0, 2),
      total: 4,
    });
  });

  it('leaves out a member that just merged and runs from the lowest open position', () => {
    const stack = { id: 'S7', number: 7, size: 4, base: 'main', open: 3, bottom: 2 };
    const merged = member(1, { ...ready, state: 'merged', stack: { ...stack, position: 1 } });
    const second = member(2, { ...ready, stack: { ...stack, position: 2 } });
    const third = member(3, { ...ready, stack: { ...stack, position: 3 } });
    const members = stackMembers([third, merged, second], 'S7');
    expect(members).toEqual([second, third]);
    expect(stackSummary(members)).toMatchObject({ mergeable: [second, third], total: 3 });
  });

  it('merges nothing when GitHub says a lower open member is not in the list', () => {
    const stack = { id: 'S7', number: 7, size: 4, base: 'main', open: 4, bottom: 1 };
    expect(stackSummary([member(2, { ...ready, stack: { ...stack, position: 2 } })])).toEqual({
      counts: { ready: 1, progress: 0, blocked: 0, draft: 0 },
      mergeable: [],
      total: 4,
    });
  });

  it('merges nothing when the bottom is missing from the list', () => {
    expect(stackSummary([member(2, ready)]).mergeable).toEqual([]);
  });

  it('tells drafts, conflicts, changes requested and work in progress apart', () => {
    expect(stackState(member(1, { isDraft: true }))).toBe('draft');
    expect(stackState(member(1, { mergeable: 'conflicting' }))).toBe('blocked');
    expect(stackState(member(1, { reviewDecision: 'changes_requested' }))).toBe('blocked');
    expect(stackState(member(1))).toBe('progress');
  });
});
