import { describe, expect, it } from 'vitest';
import { headCommit, prNode } from '../../../tests/fixtures/github';
import { mapPullRequest } from './mapPullRequest';

describe('mapPullRequest', () => {
  const checks = (commits: ReturnType<typeof headCommit>) =>
    mapPullRequest(prNode({ commits })).checks;
  describe('checks', () => {
    it.each([
      ['no rollup', headCommit(null), 'none', [0, 0, 0, 0, 0]],
      ['a rollup without counts', headCommit({}), 'none', [0, 0, 0, 0, 0]],
      ['passing runs', headCommit({ SUCCESS: 3 }), 'success', [3, 3, 0, 0, 0]],
      [
        'running runs and pending statuses',
        headCommit(
          { SUCCESS: 1, QUEUED: 1, IN_PROGRESS: 1, WAITING: 1, PENDING: 1 },
          { EXPECTED: 1 },
        ),
        'pending',
        [6, 1, 0, 5, 0],
      ],
      [
        'any failure, even with checks still running',
        headCommit({ FAILURE: 1, TIMED_OUT: 1, STARTUP_FAILURE: 1, ACTION_REQUIRED: 1, QUEUED: 2 }),
        'failure',
        [6, 0, 4, 2, 0],
      ],
      [
        'failing statuses',
        headCommit({}, { ERROR: 1, FAILURE: 1, SUCCESS: 1 }),
        'failure',
        [3, 1, 2, 0, 0],
      ],
      [
        'cancelled, skipped, stale and unknown states as neutral',
        headCommit({ CANCELLED: 1, SKIPPED: 2, NEUTRAL: 1, STALE: 1, COMPLETED: 1, NEW_STATE: 1 }),
        'success',
        [7, 0, 0, 0, 7],
      ],
    ] as const)('summarizes %s', (_, commits, state, [total, passed, failed, pending, neutral]) => {
      expect(checks(commits)).toEqual({ state, total, passed, failed, pending, neutral });
    });

    it('tolerates missing counts and commits', () => {
      const rollup = {
        contexts: { checkRunCountsByState: null, statusContextCountsByState: null },
      };
      const commit = { committedDate: '2026-10-04T16:20:00Z', statusCheckRollup: rollup };
      expect(checks({ nodes: [{ commit }] }).state).toBe('none');
      expect(checks({ nodes: null }).state).toBe('none');
      expect(checks({ nodes: [] }).state).toBe('none');
    });
  });
});
