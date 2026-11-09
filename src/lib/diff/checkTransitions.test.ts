import { describe, expect, it } from 'vitest';
import type { CheckState, PrEvent, Snapshot } from '../model';
import { CI_OUTCOME_RETAINED, carryCiOutcomes } from './checkTransitions';
import { carrySettledChecks, diffSnapshots } from './diffSnapshots';
import { ci, pr, snapshot, VIEWER } from './diffSnapshots.test-support';

function advance(prev: Snapshot, state: CheckState) {
  const next = snapshot([pr(ci(state))]);
  next.settledChecks = carrySettledChecks(prev, next.pullRequests);
  next.ciOutcomes = carryCiOutcomes(prev, next.pullRequests);
  return next;
}

describe('CI outcome identities', () => {
  it('distinguishes repeated failures and recoveries on one SHA across persisted polls', () => {
    let prev = snapshot([pr(ci('success'))]);
    const events: PrEvent[] = [];
    for (const state of [
      'failure',
      'pending',
      'failure',
      'success',
      'failure',
      'success',
    ] as const) {
      const next = advance(prev, state);
      const changes = diffSnapshots(prev, next, VIEWER);
      events.push(...changes);
      // A restarted worker reads the same persisted snapshots and reproduces the same ids.
      expect(diffSnapshots(structuredClone(prev), structuredClone(next), VIEWER)).toEqual(changes);
      prev = JSON.parse(JSON.stringify(next)) as Snapshot;
      const unchanged = advance(prev, state);
      expect(diffSnapshots(prev, unchanged, VIEWER)).toEqual([]);
      expect(unchanged.ciOutcomes).toEqual(prev.ciOutcomes);
    }
    expect(events.map(({ type }) => type)).toEqual([
      'ci_failed',
      'ci_failed',
      'ci_passed',
      'ci_failed',
      'ci_passed',
    ]);
    expect(new Set(events.map(({ id }) => id)).size).toBe(5);
  });

  it('keeps ordinals when a PR leaves and re-enters scope', () => {
    const failed = advance(snapshot([pr(ci('success'))]), 'failure');
    const absent = { ...snapshot([]), ciOutcomes: carryCiOutcomes(failed, {}) };
    const returned = advance(absent, 'success');
    expect(diffSnapshots(absent, returned, VIEWER)).toEqual([]);
    const failedAgain = advance(returned, 'failure');
    expect(failedAgain.ciOutcomes).toEqual({ [pr().id]: 2 });
  });
});

describe('CI outcome retention', () => {
  const counters = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`PR_${i}`, i + 1]));

  it('caps absent entries by evicting the oldest first, including after persistence', () => {
    const prev = { ...snapshot([]), ciOutcomes: counters(CI_OUTCOME_RETAINED + 3) };
    const outcomes = carryCiOutcomes(JSON.parse(JSON.stringify(prev)) as Snapshot, {});
    expect(Object.keys(outcomes)).toEqual(Object.keys(prev.ciOutcomes).slice(3));
    expect(Object.keys(outcomes)).toHaveLength(CI_OUTCOME_RETAINED);
    expect(outcomes.PR_3).toBe(4);
  });

  it('never evicts current PRs, even when they exceed the absent cap', () => {
    const prs = Array.from({ length: CI_OUTCOME_RETAINED + 1 }, (_, i) => pr({ id: `PR_${i}` }));
    const prev = { ...snapshot(prs), ciOutcomes: counters(CI_OUTCOME_RETAINED * 2 + 4) };
    const outcomes = carryCiOutcomes(prev, prev.pullRequests);
    for (const current of prs) expect(outcomes[current.id]).toBe(prev.ciOutcomes[current.id]);
    expect(Object.keys(outcomes)).toHaveLength(prs.length + CI_OUTCOME_RETAINED);
    expect(outcomes.PR_201).toBeUndefined();
  });

  it('moves incremented keys last but unchanged polls do not reorder them', () => {
    const prev = {
      ...snapshot([pr({ id: 'PR_0', ...ci('success') })]),
      ciOutcomes: counters(CI_OUTCOME_RETAINED + 1),
    };
    const next = snapshot([pr({ id: 'PR_0', ...ci('failure') })]);
    next.ciOutcomes = carryCiOutcomes(prev, next.pullRequests);
    expect(Object.keys(next.ciOutcomes)).toEqual([
      ...Object.keys(prev.ciOutcomes).slice(1),
      'PR_0',
    ]);
    expect(next.ciOutcomes.PR_0).toBe(2);
    const persisted = JSON.parse(JSON.stringify(next)) as Snapshot;
    const unchanged = carryCiOutcomes(persisted, persisted.pullRequests);
    expect(Object.keys(unchanged)).toEqual(Object.keys(next.ciOutcomes));
    const absent = carryCiOutcomes({ ...next, ciOutcomes: unchanged }, {});
    expect(absent.PR_1).toBeUndefined();
    expect(absent.PR_0).toBe(2);
    expect(Object.keys(absent)).toHaveLength(CI_OUTCOME_RETAINED);
  });

  it('initializes missing counters for every current PR', () => {
    const current = snapshot([pr()]);
    expect(carryCiOutcomes(null, current.pullRequests)).toEqual({ [pr().id]: 0 });
    expect(carryCiOutcomes(current, current.pullRequests)).toEqual({ [pr().id]: 0 });
  });
});
