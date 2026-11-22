import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { refreshIfStale } from './freshness';
import { auth, pollState, snapshot } from './store';

describe('refreshIfStale', () => {
  afterEach(() => {
    auth.value = undefined;
    snapshot.value = undefined;
    pollState.value = undefined;
    vi.restoreAllMocks();
  });

  const sent = () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    return () => send.mock.calls.map(([message]) => message);
  };

  it('asks for a panel poll, never a forced one: the worker decides whether it runs', () => {
    const calls = sent();
    auth.value = buildAuth();
    snapshot.value = buildSnapshot('2026-10-04T12:00:00.000Z');
    refreshIfStale();
    expect(calls()).toEqual([{ type: 'poll', reason: 'panel' }]);
  });

  it('leaves a running poll and a signed-out panel alone', () => {
    const calls = sent();
    refreshIfStale();
    auth.value = buildAuth();
    pollState.value = { ...buildPollState(), inFlight: true };
    refreshIfStale();
    expect(calls()).toEqual([]);
  });
});
