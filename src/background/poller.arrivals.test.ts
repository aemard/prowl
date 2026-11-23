import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prNode, searchResponse } from '../../tests/fixtures/github';
import { defaultSettings, updateSettings } from '../lib/storage/settings';
import { getItem, setItem } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { poll } from './poller';
import { at, github, later, MINUTE, NOW, signIn } from './poller.test-support';

/** Someone else's PR that asks the viewer (`octocat`) for a review, last updated `updatedAt`. */
const asking = (number: number, updatedAt: string) =>
  prNode({
    number,
    author: { __typename: 'User', login: 'hubot', avatarUrl: '' },
    reviewRequests: { nodes: [{ requestedReviewer: { login: 'octocat' } }] },
    updatedAt,
  });
const shown = () => [...fakeChrome().__state.notifications.keys()];

/** Notifications on, "Created by you" searched before "Review requested". */
async function twoSections() {
  const settings = defaultSettings();
  settings.notifications.enabled = true;
  settings.sections = settings.sections.map((section) => ({
    ...section,
    enabled: section.kind === 'authored' || section.kind === 'review_requested',
  }));
  await setItem('settings', settings);
  await signIn();
}

describe('poll on pull requests new to the list', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies a new review request once, not on the first poll or a section turned on', async () => {
    const review = [asking(1, '2026-10-05T12:00:00Z')];
    const mentions = [asking(3, at(NOW + 5 * MINUTE))];
    github((query) => {
      if (query?.includes('user-review-requested:@me')) return searchResponse(review);
      if (query?.includes('mentions:@me')) return searchResponse(mentions);
      return searchResponse([]);
    });
    await twoSections();

    await poll();
    expect(shown()).toEqual([]);

    review.push(asking(2, at(NOW + MINUTE)));
    later(2 * MINUTE);
    await poll();
    expect(shown()).toEqual([`${review[1]?.id}:review_requested:${at(NOW + MINUTE)}`]);

    fakeChrome().__state.notifications.clear();
    later(2 * MINUTE);
    await poll();
    expect(shown()).toEqual([]);

    // Turning "Mentioned" on brings in a PR that asked the viewer a minute ago: not news.
    await updateSettings((current) => ({
      ...current,
      sections: current.sections.map((s) => (s.kind === 'mentioned' ? { ...s, enabled: true } : s)),
    }));
    later(2 * MINUTE);
    const result = await poll();
    expect(result?.snapshot.sections.mentioned).toEqual([mentions[0]?.id]);
    expect(shown()).toEqual([]);
  });

  it('notifies a review request even when an earlier section holds a PR updated after it', async () => {
    const own = [prNode({ number: 9 })];
    const review = [asking(1, '2026-10-05T12:00:00Z')];
    github((query) => {
      if (query?.includes('user-review-requested:@me')) return searchResponse(review);
      return searchResponse(own);
    });
    await twoSections();
    await poll();

    review.push(asking(2, at(NOW + MINUTE)));
    // The viewer's own PR (searched first) got a comment after the request arrived.
    own[0] = prNode({ number: 9, updatedAt: at(NOW + 1.5 * MINUTE) });
    later(2 * MINUTE);
    await poll();
    expect(shown()).toEqual([`${review[1]?.id}:review_requested:${at(NOW + MINUTE)}`]);
  });

  it('keeps the complete list as baseline and date after a poll that failed midway', async () => {
    const own = [prNode({ number: 9 })];
    const review = [asking(1, '2026-10-05T12:00:00Z')];
    let reviewsDown = false;
    github((query) => {
      if (!query?.includes('user-review-requested:@me')) return searchResponse(own);
      if (reviewsDown) throw new TypeError('Failed to fetch');
      return searchResponse(review);
    });
    await twoSections();
    await poll();

    review.push(asking(2, at(NOW + MINUTE)));
    own[0] = prNode({ number: 9, updatedAt: at(NOW + 1.5 * MINUTE) });
    reviewsDown = true;
    later(2 * MINUTE);
    expect(await poll()).toBeNull();
    // The first section was published, dated as the last complete poll.
    const partial = await getItem('snapshot');
    expect(partial?.pullRequests[own[0].id]?.updatedAt).toBe(at(NOW + 1.5 * MINUTE));
    expect(partial?.fetchedAt).toBe(at(NOW));

    reviewsDown = false;
    later(10 * MINUTE);
    await poll();
    expect(shown()).toEqual([`${review[1]?.id}:review_requested:${at(NOW + MINUTE)}`]);
    expect((await getItem('snapshot'))?.fetchedAt).toBe(at(NOW + 12 * MINUTE));
  });
});
