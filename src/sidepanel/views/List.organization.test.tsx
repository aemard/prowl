import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PullRequest, SortOrder } from '../../lib/model';
import { buildSnapshotOf } from '../../test/panel';
import { prLocal, settings, snapshot } from '../state/store';
import { activeSectionId, ListView } from './List';
import { cardTitles, NOW, observer, pr, repo, withSections } from './List.test-support';

// Newest first: api 2, web 1, web 3, api 4, docs 5.
const inRepo = (number: number, name: string, updatedAt: string, more: Partial<PullRequest> = {}) =>
  pr(number, { repo: repo(name), updatedAt, ...more });
const web1 = inRepo(1, 'acme/web', '2026-10-05T00:00:00.000Z');
const api2 = inRepo(2, 'acme/api', '2026-10-06T00:00:00.000Z');
const web3 = inRepo(3, 'acme/web', '2026-10-04T00:00:00.000Z');
const api4 = inRepo(4, 'acme/api', '2026-10-03T00:00:00.000Z');
const docs5 = inRepo(5, 'acme/docs', '2026-10-02T00:00:00.000Z');
// The repository headers (not the empty state's heading): the text of their buttons.
const headers = () =>
  screen.queryAllByRole('heading').flatMap((h) => h.querySelector('button')?.textContent ?? []);
const header = (repoName: string) =>
  screen.getByRole('button', { name: new RegExp(`^${repoName}`) });
const group = (repoName: string) => screen.getByRole('list', { name: `${repoName} pull requests` });
const groupCards = (repoName: string) =>
  within(group(repoName))
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('.pr-card__title')?.textContent);

beforeEach(() => {
  withSections(['authored', 'review_requested'], { groupByRepo: true });
  snapshot.value = buildSnapshotOf({
    authored: [web1, api2, web3, api4, docs5],
    review_requested: [web1, docs5],
  });
});

it('grouped by repository is off until the setting is on: one flat list that names the repository on each card', () => {
  withSections(['authored'], { groupByRepo: false });
  render(<ListView />);
  expect(screen.queryAllByRole('heading')).toEqual([]);
  expect(cardTitles()).toHaveLength(5);
  expect(document.querySelectorAll('.pr-card__repo-name')).toHaveLength(5);
});

it('grouped by repository puts each repository under a header with its count, groups in the order of their first PR', () => {
  render(<ListView />);
  expect(headers()).toEqual([
    'acme/api2 pull requests',
    'acme/web2 pull requests',
    'acme/docs1 pull request',
  ]);
  expect(groupCards('acme/api')).toEqual(['PR number 2', 'PR number 4']);
  expect(groupCards('acme/web')).toEqual(['PR number 1', 'PR number 3']);
  expect(groupCards('acme/docs')).toEqual(['PR number 5']);
  // The headers name the repository, so the cards drop it and keep the number.
  expect(document.querySelectorAll('.pr-card__repo-name')).toHaveLength(0);
  expect([...document.querySelectorAll('.pr-card__number')].map((n) => n.textContent)).toEqual([
    '#2',
    '#4',
    '#1',
    '#3',
    '#5',
  ]);
  // List semantics: the section's list holds the groups, each holds its cards.
  const outer = screen.getByRole('list', { name: 'Created by me pull requests' });
  expect(within(outer).getAllByRole('heading')).toHaveLength(3);
  expect(screen.getAllByRole('list')).toHaveLength(4);
});

it.each<[SortOrder, string[]]>([
  ['updated', ['acme/api', 'acme/web', 'acme/docs']],
  ['repo', ['acme/api', 'acme/docs', 'acme/web']],
])('grouped by repository follows the sort: by %s', (sort, expected) => {
  withSections(['authored'], { groupByRepo: true, sort });
  render(<ListView />);
  expect(headers().map((text) => text?.replace(/\d.*$/, ''))).toEqual(expected);
});

it('grouped by repository keeps the order of the sort inside a group, and the section count of cards', () => {
  withSections(['authored', 'review_requested'], { groupByRepo: true, sort: 'created' });
  snapshot.value = buildSnapshotOf({
    authored: [
      inRepo(1, 'acme/web', '2026-10-05T00:00:00.000Z', {
        createdAt: '2026-10-01T00:00:00.000Z',
      }),
      inRepo(2, 'acme/web', '2026-10-06T00:00:00.000Z', {
        createdAt: '2026-10-02T00:00:00.000Z',
      }),
    ],
  });
  render(<ListView />);
  expect(groupCards('acme/web')).toEqual(['PR number 2', 'PR number 1']);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Mine2', 'Review0']);
});

it('grouped by repository folds a group with its button, and unfolds it, without changing any count', () => {
  render(<ListView />);
  const api = header('acme/api');
  expect(api.getAttribute('aria-expanded')).toBe('true');
  expect(api.getAttribute('aria-controls')).toBe(group('acme/api').id);

  fireEvent.click(api);
  expect(api.getAttribute('aria-expanded')).toBe('false');
  expect(api.hasAttribute('aria-controls')).toBe(false);
  expect(screen.queryByRole('list', { name: 'acme/api pull requests' })).toBeNull();
  expect(cardTitles()).toEqual(['PR number 1', 'PR number 3', 'PR number 5']);
  // The header still says how many are inside, and the bar still counts them.
  expect(api.textContent).toBe('acme/api2 pull requests');
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Mine5');

  fireEvent.click(api);
  expect(groupCards('acme/api')).toEqual(['PR number 2', 'PR number 4']);
});

it('grouped by repository remembers what is folded for the session, per section', () => {
  const { unmount } = render(<ListView />);
  fireEvent.click(header('acme/web'));
  expect(cardTitles()).toEqual(['PR number 2', 'PR number 4', 'PR number 5']);

  // Another section has its own groups, the same repository included.
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }));
  expect(header('acme/web').getAttribute('aria-expanded')).toBe('true');
  expect(cardTitles()).toEqual(['PR number 1', 'PR number 5']);

  // Settings and back: the view is rebuilt, the folds are not lost.
  unmount();
  activeSectionId.value = undefined;
  render(<ListView />);
  expect(header('acme/web').getAttribute('aria-expanded')).toBe('false');
  expect(cardTitles()).toEqual(['PR number 2', 'PR number 4', 'PR number 5']);
});

it('grouped by repository follows the quick filter: groups without a match go, and the counts are the matches', () => {
  render(<ListView />);
  fireEvent.click(header('acme/docs'));
  fireEvent.input(screen.getByRole('searchbox', { name: 'Filter pull requests' }), {
    target: { value: 'number 4' },
  });
  expect(headers()).toEqual(['acme/api1 pull request']);
  expect(cardTitles()).toEqual(['PR number 4']);
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Mine1');

  fireEvent.input(screen.getByRole('searchbox', { name: 'Filter pull requests' }), {
    target: { value: 'acme/web' },
  });
  expect(headers()).toEqual(['acme/web2 pull requests']);

  // Nothing matches: the usual empty state, no headers.
  fireEvent.input(screen.getByRole('searchbox', { name: 'Filter pull requests' }), {
    target: { value: 'nothing at all' },
  });
  expect(headers()).toEqual([]);
  expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();

  // A folded group stays folded when the filter is cleared.
  fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
  expect(header('acme/docs').getAttribute('aria-expanded')).toBe('false');
});

it('grouped by repository keeps hidden and snoozed PRs in lists of their own, flat, with the repository on each card', () => {
  const old = inRepo(6, 'acme/web', '2026-09-01T00:00:00.000Z', {
    lastCommitAt: '2026-09-01T00:00:00.000Z',
  });
  const snoozed = inRepo(7, 'acme/api', '2026-10-06T08:00:00.000Z');
  snapshot.value = buildSnapshotOf({ authored: [web1, api2, old, snoozed] });
  prLocal.value = {
    snoozed: { [snoozed.id]: new Date(NOW + 3_600_000).toISOString() },
    muted: {},
    seen: {},
  };
  render(<ListView />);
  expect(headers()).toEqual(['acme/api1 pull request', 'acme/web1 pull request']);

  fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden' }));
  const revealed = screen.getByRole('list', { name: 'Hidden Created by me pull requests' });
  expect(within(revealed).queryAllByRole('heading')).toEqual([]);
  expect(within(revealed).getByText('acme/web')).toBeTruthy();
  expect(within(revealed).getByTitle('Why it is hidden from the list').textContent).toBe(
    'No commit for 35 d',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Snoozed (1)' }));
  const snoozedList = screen.getByRole('list', { name: 'Snoozed Created by me pull requests' });
  expect(within(snoozedList).queryAllByRole('heading')).toEqual([]);
  expect(within(snoozedList).getByText('acme/api')).toBeTruthy();
  // Neither is in a group or in the counts.
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Mine2');
  expect(headers()).toEqual(['acme/api1 pull request', 'acme/web1 pull request']);
});

it('grouped by repository observes only the cards of open groups for the seen mark, and the others once unfolded', () => {
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  render(<ListView />);
  const observed = () => observer().targets.map((t) => (t as HTMLElement).dataset.prId);
  expect(observed()).toEqual([api2.id, api4.id, web1.id, web3.id, docs5.id]);

  fireEvent.click(header('acme/api'));
  expect(observed()).toEqual([web1.id, web3.id, docs5.id]);
  observer().show([api2.id, web1.id]);
  act(() => void vi.advanceTimersByTime(1500));
  const marked = (send.mock.calls as unknown[][])
    .map(([message]) => message as { type: string; prIds?: string[] })
    .filter((message) => message.type === 'markSeen');
  expect(marked).toEqual([{ type: 'markSeen', prIds: [web1.id] }]);

  fireEvent.click(header('acme/api'));
  expect(observed()).toEqual([api2.id, api4.id, web1.id, web3.id, docs5.id]);
});

it('grouped by repository shows no empty group for a section whose PRs are all hidden or snoozed', () => {
  const only = inRepo(1, 'acme/web', '2026-10-05T00:00:00.000Z', {
    lastCommitAt: '2026-08-01T00:00:00.000Z',
  });
  snapshot.value = buildSnapshotOf({ authored: [only] });
  render(<ListView />);
  expect(headers()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Show 1 hidden' })).toBeTruthy();
});

it('grouped by repository switches with the setting, while the list is open', () => {
  render(<ListView />);
  expect(headers()).toHaveLength(3);
  act(() => {
    settings.value = { ...settings.value, groupByRepo: false };
  });
  expect(headers()).toEqual([]);
  expect(cardTitles()).toHaveLength(5);
});
