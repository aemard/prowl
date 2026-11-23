import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PollState } from '../../lib/model';
import { buildAuth, buildPollState, buildPullRequest } from '../../test/panel';
import { readClient } from './readClient';
import { loadThreads, reviewThreads } from './reviewThreads';
import { auth, pollState } from './store';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const IN_TEN = new Date(NOW + 10 * 60_000).toISOString();
const answer = vi.fn(async (): Promise<Response> => jsonResponse({ data: { viewer: {} } }));

describe('readClient', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.stubGlobal('fetch', answer);
  });
  afterEach(() => {
    pollState.value = undefined;
    auth.value = undefined;
    reviewThreads.value = {};
    answer.mockClear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each<[string, Partial<PollState>]>([
    ['after a rate limit', { lastError: { kind: 'rate_limited', message: 'x' } }],
    ['after a success that left a low budget', { lastError: null }],
  ])('refuses every read during the rate-limit wait %s, asking GitHub nothing', async (_, s) => {
    pollState.value = buildPollState({ nextAllowedAt: IN_TEN, ...s });
    const client = readClient('t');
    for (const read of [
      () => client.graphql('query X { viewer { login } }'),
      () => client.rest('GET', '/user'),
      () => client.restResponse('GET', '/user'),
    ])
      await expect(read()).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(answer).not.toHaveBeenCalled();
  });

  it('reads during an error backoff, and once the wait is over', async () => {
    pollState.value = buildPollState({
      nextAllowedAt: IN_TEN,
      lastError: { kind: 'network', message: 'x' },
    });
    await readClient('t').graphql('query X { viewer { login } }');
    pollState.value = buildPollState({
      nextAllowedAt: new Date(NOW - 1).toISOString(),
      lastError: { kind: 'rate_limited', message: 'x' },
    });
    await readClient('t').graphql('query X { viewer { login } }');
    expect(answer).toHaveBeenCalledTimes(2);
  });

  it("tells a card's reader when GitHub may be asked again", async () => {
    auth.value = buildAuth();
    pollState.value = buildPollState({ nextAllowedAt: IN_TEN });
    const pr = buildPullRequest({ unresolvedThreads: 1 });
    await loadThreads(pr);
    expect(reviewThreads.value[pr.id]?.error).toMatch(/Rate limited until/);
    expect(answer).not.toHaveBeenCalled();
  });
});
