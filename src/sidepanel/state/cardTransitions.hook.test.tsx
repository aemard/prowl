import { act, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PollState, Snapshot } from '../../lib/model';
import { buildPollState, buildPullRequest, buildSnapshotOf } from '../../test/panel';
import {
  CARD_ENTER_MS,
  CARD_TRANSITION_MS,
  DEPARTURE_TIMEOUT_MS,
  useCardTransitions,
} from './cardTransitions';

function setup(source?: Snapshot, poll?: PollState, scope = '') {
  let result: ReturnType<typeof useCardTransitions>;
  function Probe({
    snap,
    status = poll,
    keyScope = scope,
  }: {
    snap?: Snapshot;
    status?: PollState;
    keyScope?: string;
  }) {
    result = useCardTransitions(snap, status, keyScope);
    return null;
  }
  const view = render(<Probe snap={source} />);
  return {
    read: () => ({ snap: result.snap, activity: result.activity }),
    sections: () => result.activityBySection,
    update: (snap?: Snapshot, status = poll, keyScope = scope) =>
      view.rerender(<Probe snap={snap} status={status} keyScope={keyScope} />),
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

  it('keeps new activity through entry and the highlight fade', () => {
    vi.useFakeTimers();
    const pr = buildPullRequest({ createdAt: '2026-01-02T00:00:00Z' });
    const probe = setup(buildSnapshotOf({ authored: [] }, { fetchedAt: '2026-01-01T00:00:00Z' }));
    const after = buildSnapshotOf({ authored: [pr] });
    probe.update(after);
    expect(probe.read().activity).toEqual({ [pr.id]: 'new' });
    act(() => {
      vi.advanceTimersByTime(CARD_ENTER_MS - 1);
    });
    expect(probe.read().activity).toEqual({ [pr.id]: 'new' });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(probe.read()).toEqual({ snap: after, activity: {} });
    probe.unmount();
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

describe('progressive departures with two enabled sections', () => {
  const pr = buildPullRequest();
  const sibling = buildPullRequest({ number: 2 });
  const before = buildSnapshotOf({ authored: [pr, sibling], review_requested: [] });
  const absent = buildSnapshotOf({ authored: [sibling], review_requested: [] });
  const busy = buildPollState({ inFlight: true });

  it.each(['merged', 'closed'] as const)(
    'retains the open baseline until %s is published',
    (kind) => {
      vi.useFakeTimers();
      const probe = setup(before, busy);
      probe.update(absent);
      expect(probe.read().snap?.sections.authored).toEqual([pr.id, sibling.id]);
      expect(probe.read().snap?.pullRequests[pr.id]).toEqual(pr);
      expect(probe.read().activity).toEqual({});
      const terminal = {
        ...absent,
        pullRequests: { ...absent.pullRequests, [pr.id]: { ...pr, state: kind } },
      };
      probe.update(terminal);
      expect(probe.read().activity).toEqual({ [pr.id]: kind });
      act(() => {
        vi.advanceTimersByTime(CARD_TRANSITION_MS);
      });
      expect(probe.read().snap?.sections.authored).toEqual([sibling.id]);
      probe.unmount();
    },
  );

  it('cancels an unknown departure when a later section returns the open PR', () => {
    vi.useFakeTimers();
    const probe = setup(before, busy);
    probe.update(absent);
    expect(probe.read().snap?.sections.authored).toContain(pr.id);
    probe.update(before);
    expect(probe.read().activity).toEqual({});
    act(() => {
      vi.advanceTimersByTime(DEPARTURE_TIMEOUT_MS);
    });
    expect(probe.read().snap?.sections.authored).toContain(pr.id);
    probe.unmount();
  });

  it.each(['poll ends', 'timeout'])('uses an unlabelled fade when %s', (reason) => {
    vi.useFakeTimers();
    const probe = setup(before, busy);
    probe.update(absent);
    expect(probe.read().activity).toEqual({});
    expect(probe.read().snap?.sections.authored).toContain(pr.id);
    if (reason === 'poll ends') probe.update(absent, buildPollState());
    else
      act(() => {
        vi.advanceTimersByTime(DEPARTURE_TIMEOUT_MS);
      });
    expect(probe.read().activity).toEqual({ [pr.id]: 'fade' });
    expect(probe.read().snap?.sections.authored).toContain(pr.id);
    act(() => {
      vi.advanceTimersByTime(CARD_TRANSITION_MS);
    });
    expect(probe.read().snap?.sections.authored).toEqual([sibling.id]);
    probe.unmount();
  });

  it('drops pending departures quietly on scope changes', () => {
    const probe = setup(before, busy);
    probe.update(absent);
    probe.update(absent, busy, 'new scope');
    expect(probe.read()).toEqual({ snap: absent, activity: {} });
    probe.unmount();
  });
});

describe('section membership departures while the PR remains open', () => {
  const prs = [101, 102, 104, 103, 105].map((number) => buildPullRequest({ number }));
  const pr = buildPullRequest({ number: 101 });
  const before = buildSnapshotOf({ authored: prs, review_requested: prs });
  const partial = {
    ...before,
    sections: { ...before.sections, authored: prs.slice(1).map((p) => p.id) },
  };
  const busy = buildPollState({ inFlight: true });

  it.each(['merged', 'closed'] as const)(
    'retains the original position through the progressive %s trace',
    (kind) => {
      vi.useFakeTimers();
      const probe = setup(before, busy);
      probe.update(partial);
      expect(probe.read().snap?.sections).toEqual(before.sections);
      expect(probe.read().snap?.pullRequests[pr.id]?.state).toBe('open');
      expect(probe.read().activity).toEqual({});
      const terminal = {
        ...partial,
        pullRequests: { ...partial.pullRequests, [pr.id]: { ...pr, state: kind } },
        sections: {
          authored: partial.sections.authored ?? [],
          review_requested: partial.sections.authored ?? [],
        },
      };
      probe.update(terminal);
      expect(probe.sections()).toEqual({
        authored: { [pr.id]: kind },
        review_requested: { [pr.id]: kind },
      });
      expect(probe.read().snap?.sections).toEqual(before.sections);
      act(() => {
        vi.advanceTimersByTime(CARD_TRANSITION_MS);
      });
      probe.update(terminal, buildPollState());
      expect(probe.read()).toEqual({ snap: terminal, activity: {} });
      probe.unmount();
    },
  );

  it.each(['poll ends', 'timeout'])('fades only the departed section when %s', (reason) => {
    vi.useFakeTimers();
    const probe = setup(before, busy);
    probe.update(partial);
    expect(probe.read().snap?.sections).toEqual(before.sections);
    if (reason === 'poll ends') probe.update(partial, buildPollState());
    else
      act(() => {
        vi.advanceTimersByTime(DEPARTURE_TIMEOUT_MS);
      });
    expect(probe.sections()).toEqual({ authored: { [pr.id]: 'fade' } });
    act(() => {
      vi.advanceTimersByTime(CARD_TRANSITION_MS);
    });
    expect(probe.read()).toEqual({ snap: partial, activity: {} });
    probe.unmount();
  });

  it('cancels only the section that regains membership', () => {
    vi.useFakeTimers();
    const probe = setup(before, busy);
    probe.update({
      ...partial,
      sections: {
        authored: partial.sections.authored ?? [],
        review_requested: partial.sections.authored ?? [],
      },
    });
    probe.update(partial);
    probe.update(partial, buildPollState());
    expect(probe.sections()).toEqual({ authored: { [pr.id]: 'fade' } });
    probe.update(before);
    expect(probe.read()).toEqual({ snap: before, activity: {} });
    act(() => {
      vi.advanceTimersByTime(DEPARTURE_TIMEOUT_MS);
    });
    expect(probe.read()).toEqual({ snap: before, activity: {} });
    probe.unmount();
  });

  it('keeps newly enabled and disabled sections quiet', () => {
    const probe = setup(partial, busy);
    const disabled = {
      ...partial,
      sections: { review_requested: before.sections.review_requested ?? [] },
    };
    probe.update(disabled);
    expect(probe.read()).toEqual({ snap: disabled, activity: {} });
    probe.update(before);
    expect(probe.read()).toEqual({ snap: before, activity: {} });
    probe.unmount();
  });
});
