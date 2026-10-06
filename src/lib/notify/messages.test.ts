import { describe, expect, it } from 'vitest';
import { prEvent } from '../../../tests/fixtures/events';
import type { PrEventType } from '../model';
import { notificationContent, summaryContent } from './messages';

describe('notificationContent', () => {
  it.each([
    ['ci_failed', null, 'CI failed'],
    ['ci_passed', null, 'CI passed'],
    ['review_new', 'hubot', 'hubot reviewed'],
    ['approved', 'hubot', 'hubot approved'],
    ['changes_requested', 'hubot', 'hubot requested changes'],
    ['comment_new', 'hubot', 'hubot commented'],
    ['ready_to_merge', null, 'Ready to merge'],
    ['merged', 'hubot', 'Merged by hubot'],
    ['closed', 'hubot', 'Closed by hubot'],
  ] satisfies [PrEventType, string | null, string][])('titles %s by %s', (type, actor, title) => {
    expect(notificationContent(prEvent({ type, actor })).title).toBe(title);
  });

  it.each([
    ['review_new', 'Someone reviewed'],
    ['approved', 'Someone approved'],
    ['changes_requested', 'Someone requested changes'],
    ['comment_new', 'Someone commented'],
    ['merged', 'Merged'],
    ['closed', 'Closed'],
  ] satisfies [PrEventType, string][])('titles %s without an actor', (type, title) => {
    expect(notificationContent(prEvent({ type, actor: null })).title).toBe(title);
  });

  it('puts the PR title in the message and the PR in the context', () => {
    expect(notificationContent(prEvent({ number: 12, title: 'Fix the flux' }))).toMatchObject({
      message: 'Fix the flux',
      contextMessage: 'acme/widgets#12',
    });
  });
});

describe('summaryContent', () => {
  const events = (...numbers: number[]) => numbers.map((number) => prEvent({ number }));

  it('counts the events and names the pull requests', () => {
    expect(summaryContent(events(1, 2, 3, 4))).toEqual({
      title: '4 pull request updates',
      message: 'acme/widgets#1, acme/widgets#2, acme/widgets#3 and 1 more',
    });
  });

  it('names a pull request once however many events it has', () => {
    const many = [...events(1, 1, 1), prEvent({ type: 'approved', number: 2 })];
    expect(summaryContent(many)).toEqual({
      title: '4 pull request updates',
      message: 'acme/widgets#1, acme/widgets#2',
    });
  });
});
