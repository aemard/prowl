import { act, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../lib/model';
import { buildPullRequest, buildSnapshotOf } from '../../test/panel';
import { CARD_TRANSITION_MS, useCardTransitions } from './cardTransitions';

function setup(source?: Snapshot) {
  let result: ReturnType<typeof useCardTransitions>;
  function Probe({ snap }: { snap?: Snapshot }) {
    result = useCardTransitions(snap);
    return null;
  }
  const view = render(<Probe snap={source} />);
  return {
    read: () => result,
    update: (snap?: Snapshot) => view.rerender(<Probe snap={snap} />),
    unmount: view.unmount,
  };
}

afterEach(() => vi.useRealTimers());

describe('card transition lifecycle', () => {
  it('keeps initial and asynchronously loaded snapshots quiet', () => {
    const snap = buildSnapshotOf({ authored: [buildPullRequest()] });
    const probe = setup();
    probe.update(snap);
    expect(probe.read()).toEqual({ snap, activity: {} });
    probe.unmount();
    expect(setup(snap).read()).toEqual({ snap, activity: {} });
  });

  it('retains a closure until the timer expires and cancels it on unmount', () => {
    vi.useFakeTimers();
    const pr = buildPullRequest();
    const before = buildSnapshotOf({ authored: [pr] });
    const after = buildSnapshotOf(
      { authored: [] },
      {
        pullRequests: { [pr.id]: { ...pr, state: 'closed' } },
      },
    );
    const probe = setup(before);
    probe.update(after);
    expect(probe.read().activity).toEqual({ [pr.id]: 'closed' });
    expect(probe.read().snap?.sections.authored).toEqual([pr.id]);
    act(() => {
      vi.advanceTimersByTime(CARD_TRANSITION_MS);
    });
    expect(probe.read()).toEqual({ snap: after, activity: {} });
    probe.update(before);
    probe.update(after);
    probe.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears departing activity when reopened or switching accounts', () => {
    const pr = buildPullRequest();
    const before = buildSnapshotOf({ authored: [pr] });
    const closed = buildSnapshotOf({ authored: [{ ...pr, state: 'merged' }] });
    const probe = setup(before);
    probe.update(closed);
    probe.update(before);
    expect(probe.read().activity).toEqual({});
    probe.update(closed);
    const other = { ...before, viewer: { ...before.viewer, login: 'someone-else' } };
    probe.update(other);
    expect(probe.read()).toEqual({ snap: other, activity: {} });
    probe.update(undefined);
    expect(probe.read()).toEqual({ snap: undefined, activity: {} });
  });
});
