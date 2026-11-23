import { describe, expect, it } from 'vitest';
import type { PullRequest, Snapshot } from '../model';
import { diffSnapshots, seenUntil } from './diffSnapshots';
import { pr, VIEWER } from './diffSnapshots.test-support';

const SEEN = '2026-10-06T09:00:00.000Z';
const POLLED = '2026-10-06T09:02:00.000Z';
const ASKED = '2026-10-06T09:01:00Z';
const OLD = '2026-10-06T08:00:00Z';
const SCOPE = '["is:pr is:open user-review-requested:@me archived:false",[],50,[]]';

const known = pr({ updatedAt: OLD });
/** Someone else's PR that asks the viewer for a review. */
const asked = (overrides: Partial<PullRequest> = {}) =>
  pr({
    id: 'PR_asked',
    number: 2,
    author: { login: 'hubot', avatarUrl: '', isBot: false },
    requestedReviewers: [VIEWER],
    updatedAt: ASKED,
    ...overrides,
  });

/** A poll that found `prs` in the review section, searched with `scope`. */
function poll(prs: PullRequest[], fetchedAt: string, scope: string | null = SCOPE): Snapshot {
  return {
    fetchedAt,
    viewer: { login: VIEWER, avatarUrl: '', name: null },
    pullRequests: Object.fromEntries(prs.map((p) => [p.id, p])),
    sections: { review: prs.map(({ id }) => id) },
    ...(scope === null ? {} : { sectionScopes: { review: scope } }),
  };
}
const types = (prev: Snapshot | null, next: Snapshot) =>
  diffSnapshots(prev, next, VIEWER).map(({ type, number }) => [type, number]);

describe('diffSnapshots on pull requests new to the previous poll', () => {
  it('says once that a review is asked on a new pull request', () => {
    const prev = poll([known], SEEN);
    const next = poll([known, asked()], POLLED);
    expect(diffSnapshots(prev, next, VIEWER)).toEqual([
      expect.objectContaining({
        id: `PR_asked:review_requested:${ASKED}`,
        type: 'review_requested',
        number: 2,
        actor: null,
        at: ASKED,
      }),
    ]);
    // The next poll has it as a baseline; a replay of the same poll gives the same id.
    expect(types(next, poll([known, asked()], '2026-10-06T09:04:00.000Z'))).toEqual([]);
    expect(diffSnapshots(prev, next, VIEWER)[0]?.id).toBe(`PR_asked:review_requested:${ASKED}`);
  });

  it('takes the arrival cut-off it is given over the one of a publication it diffs from', () => {
    const baseline = poll([known], SEEN);
    // A poll's first publication already holds a PR GitHub updated after the review was asked
    // (with a local clock running ahead, even dated as the baseline it would put the cut-off there).
    const own = pr({ id: 'PR_own', updatedAt: '2026-10-06T09:01:30Z' });
    const published = poll([known, own], '2026-10-06T09:01:50.000Z');
    const next = poll([...Object.values(published.pullRequests), asked()], POLLED);
    expect(diffSnapshots(published, next, VIEWER)).toEqual([]);
    expect(
      diffSnapshots(published, next, VIEWER, seenUntil(baseline)).map(({ type }) => type),
    ).toEqual(['review_requested']);
  });

  it('says nothing on the first poll or for another account', () => {
    expect(types(null, poll([asked()], POLLED))).toEqual([]);
    const theirs = {
      ...poll([known], SEEN),
      viewer: { login: 'hubot', avatarUrl: '', name: null },
    };
    expect(types(theirs, poll([known, asked()], POLLED))).toEqual([]);
  });

  it('says nothing for a section the previous poll did not search the same way', () => {
    // Turned on since: the previous poll has no scope for it.
    const off = { ...poll([known], SEEN), sections: {}, sectionScopes: {} };
    expect(types(off, poll([known, asked()], POLLED))).toEqual([]);
    // Its query, a filter or the limit changed.
    expect(types(poll([known], SEEN, 'other'), poll([known, asked()], POLLED))).toEqual([]);
    // Polled before Prowl recorded scopes.
    expect(types(poll([known], SEEN, null), poll([known, asked()], POLLED))).toEqual([]);
  });

  it('says nothing for a pull request GitHub did not change since the previous poll', () => {
    // An earlier search missed it, or it was past the limit: the request is old news.
    const missed = asked({ updatedAt: '2026-10-06T07:00:00Z' });
    expect(types(poll([known], SEEN), poll([known, missed], POLLED))).toEqual([]);
  });

  it('dates the previous poll by what GitHub showed it when the local clock runs ahead', () => {
    const ahead = poll([known], '2026-10-06T11:00:00.000Z');
    expect(types(ahead, poll([known, asked()], POLLED))).toEqual([['review_requested', 2]]);
  });

  it('says your turn for another reason, and nothing when it is not the viewer’s move', () => {
    const conflicting = pr({
      id: 'PR_mine',
      number: 3,
      mergeable: 'conflicting',
      updatedAt: ASKED,
    });
    const events = diffSnapshots(poll([known], SEEN), poll([known, conflicting], POLLED), VIEWER);
    expect(events.map(({ type, number, reason }) => [type, number, reason])).toEqual([
      ['your_turn', 3, 'conflicts'],
    ]);
    const notYours = asked({ requestedReviewers: [] });
    expect(types(poll([known], SEEN), poll([known, notYours], POLLED))).toEqual([]);
  });

  it('says review requested when a known pull request asks the viewer again', () => {
    const reviewed = asked({ requestedReviewers: [], updatedAt: OLD });
    const next = poll([known, asked()], POLLED);
    expect(types(poll([known, reviewed], SEEN), next)).toEqual([['review_requested', 2]]);
  });
});
