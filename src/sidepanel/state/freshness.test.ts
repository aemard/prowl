import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { refreshIfStale } from './freshness';
import { auth, pollState, snapshot } from './store';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

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

  it('forces a poll when the list is missing or older than a minute', () => {
    const calls = sent();
    auth.value = buildAuth();
    refreshIfStale(NOW);
    snapshot.value = buildSnapshot('2026-10-04T12:00:00.000Z');
    refreshIfStale(NOW);
    expect(calls()).toEqual([
      { type: 'poll', force: true },
      { type: 'poll', force: true },
    ]);
  });

  it('leaves a fresh list, a running poll and a signed-out panel alone', () => {
    const calls = sent();
    refreshIfStale(NOW);
    auth.value = buildAuth();
    snapshot.value = buildSnapshot('2026-10-06T11:59:30.000Z');
    refreshIfStale(NOW);
    snapshot.value = undefined;
    pollState.value = { ...buildPollState(), inFlight: true };
    refreshIfStale(NOW);
    expect(calls()).toEqual([]);
  });
});
