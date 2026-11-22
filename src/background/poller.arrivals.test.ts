import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prNode, searchResponse } from '../../tests/fixtures/github';
import { defaultSettings, updateSettings } from '../lib/storage/settings';
import { setItem } from '../lib/storage/storage';
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
    const settings = defaultSettings();
    settings.notifications.enabled = true;
    settings.sections = settings.sections.map((section) => ({
      ...section,
      enabled: section.kind === 'authored' || section.kind === 'review_requested',
    }));
    await setItem('settings', settings);
    await signIn();

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
});
