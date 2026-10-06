/** Builders for the stored values the side panel reads. Used by the panel's unit tests. */
import type { AuthState, PollState, Snapshot } from '../lib/model';

export function buildAuth(login = 'octocat'): AuthState {
  return {
    method: 'pat',
    token: 'ghp_test',
    tokenType: 'classic',
    scopes: ['repo'],
    viewer: { login, avatarUrl: `https://avatars.githubusercontent.com/${login}`, name: null },
    createdAt: '2026-10-06T08:00:00.000Z',
  };
}

export function buildSnapshot(fetchedAt = '2026-10-06T11:58:00.000Z'): Snapshot {
  return { fetchedAt, viewer: buildAuth().viewer, pullRequests: {}, sections: {} };
}

export function buildPollState(overrides: Partial<PollState> = {}): PollState {
  return {
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextAllowedAt: null,
    consecutiveFailures: 0,
    rateLimit: null,
    lastError: null,
    inFlight: false,
    ...overrides,
  };
}
