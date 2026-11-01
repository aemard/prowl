import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SortOrder } from '../../lib/model';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildPollState, buildSnapshot, buildSnapshotOf } from '../../test/panel';
import { auth, pollState, settings, snapshot } from '../state/store';
import { ListView } from './List';
import { cardTitles, observer, pr, repo, titles, withSections } from './List.test-support';

it('states without pull requests points to Settings when no section is turned on', () => {
  withSections([]);
  render(<ListView />);
  expect(screen.getByRole('heading', { name: 'No sections turned on' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  expect(location.hash).toBe('#/settings');
});

it('states without pull requests shows a skeleton while the first poll runs', () => {
  pollState.value = buildPollState({ inFlight: true });
  render(<ListView />);
  const loading = screen.getByRole('status', { name: 'Loading pull requests' });
  expect(loading.getAttribute('aria-busy')).toBe('true');
  expect(screen.queryByRole('link')).toBeNull();
});

it('states without pull requests says nothing loaded and leaves the reason and the retry to the banner', () => {
  pollState.value = buildPollState({
    lastError: { kind: 'network', message: 'You are offline' },
  });
  render(<ListView />);
  expect(screen.getByRole('heading', { name: 'Could not load pull requests' })).toBeTruthy();
  expect(screen.getByText(/The notice above says why/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' }).closest('.status-banner')).toBeTruthy();
});

it('states without pull requests keeps the skeleton while a retry is running', () => {
  pollState.value = buildPollState({
    inFlight: true,
    lastError: { kind: 'network', message: 'You are offline' },
  });
  render(<ListView />);
  expect(screen.getByRole('status', { name: 'Loading pull requests' })).toBeTruthy();
});

it('states without pull requests explains an empty section for its kind, without a filter box', () => {
  snapshot.value = buildSnapshotOf({ authored: [] });
  render(<ListView />);
  expect(screen.getByRole('heading', { name: 'No pull requests' })).toBeTruthy();
  expect(screen.getByText('Pull requests you open will show up here.')).toBeTruthy();
  expect(screen.queryByRole('searchbox')).toBeNull();
});

describe('one section', () => {
  beforeEach(() => {
    snapshot.value = buildSnapshotOf({
      authored: [
        pr(1, { updatedAt: '2026-10-05T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' }),
        pr(2, { updatedAt: '2026-10-06T00:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z' }),
        pr(3, {
          updatedAt: '2026-10-04T00:00:00.000Z',
          createdAt: '2026-10-03T00:00:00.000Z',
          repo: repo('acme/api'),
        }),
      ],
    });
  });

  it('has no tabs, a labelled list and the quick filter', () => {
    settings.value = { ...settings.value, groupByRepo: false };
    render(<ListView />);
    expect(screen.queryByRole('tablist')).toBeNull();
    const list = screen.getByRole('list', { name: 'Created by me pull requests' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('searchbox', { name: 'Filter pull requests' })).toBeTruthy();
  });

  it.each<[SortOrder, string[]]>([
    ['updated', ['PR number 2', 'PR number 1', 'PR number 3']],
    ['created', ['PR number 3', 'PR number 2', 'PR number 1']],
    ['repo', ['PR number 3', 'PR number 2', 'PR number 1']],
  ])('sorts by %s', (sort, expected) => {
    withSections(['authored'], { sort });
    render(<ListView />);
    expect(cardTitles()).toEqual(expected);
  });

  it('filters as you type and says when nothing matches, then clears', () => {
    render(<ListView />);
    const box = screen.getByRole('searchbox', { name: 'Filter pull requests' });
    fireEvent.input(box, { target: { value: 'acme/api' } });
    expect(cardTitles()).toEqual(['PR number 3']);

    fireEvent.input(box, { target: { value: 'nothing like this' } });
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();
    expect(
      screen.getByText('Nothing in “Created by me” matches “nothing like this”.'),
    ).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(cardTitles()).toHaveLength(3);
    expect((box as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(box);
  });

  it('keeps the filter when the view is left and opened again', () => {
    const first = render(<ListView />);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'api' } });
    first.unmount();
    render(<ListView />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('api');
    expect(cardTitles()).toEqual(['PR number 3']);
  });
});

it('relative times keep up with the clock', () => {
  snapshot.value = buildSnapshotOf({
    authored: [pr(1, { updatedAt: '2026-10-06T11:58:00.000Z' })],
  });
  render(<ListView />);
  expect(screen.getByText('2 min ago')).toBeTruthy();
  act(() => void vi.advanceTimersByTime(3 * 60_000));
  expect(screen.getByText('5 min ago')).toBeTruthy();
});

it('a snapshot with a PR missing skips ids that have no pull request', () => {
  const snap = buildSnapshot();
  snap.sections.authored = ['gone'];
  snapshot.value = snap;
  render(<ListView />);
  expect(titles()).toEqual([]);
  expect(screen.getByRole('heading', { name: 'No pull requests' })).toBeTruthy();
});

describe('expanded cards', () => {
  const a = pr(1);
  const b = pr(2);
  const toggle = (n: number) => screen.getByRole('button', { name: `Details for PR number ${n}` });

  beforeEach(() => {
    auth.value = buildAuth();
    stubDetailFetch();
    withSections(['authored', 'review_requested']);
    snapshot.value = buildSnapshotOf({ authored: [a, b], review_requested: [pr(3)] });
  });

  it('stay open through a background refresh, a tab switch and a visit to Settings', async () => {
    const { unmount } = render(<ListView />);
    fireEvent.click(toggle(2));
    await screen.findByRole('list', { name: 'Merge' });

    // A new poll: same PRs in new objects, one of them updated.
    act(() => {
      snapshot.value = buildSnapshotOf(
        {
          authored: [a, { ...b, updatedAt: '2026-10-06T11:00:00.000Z' }],
          review_requested: [pr(3)],
        },
        { fetchedAt: '2026-10-06T12:00:00.000Z' },
      );
    });
    expect(toggle(2).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(1).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('list', { name: 'Merge' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('tab', { name: /^Review/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Mine/ }));
    expect(toggle(2).getAttribute('aria-expanded')).toBe('true');

    unmount();
    render(<ListView />);
    expect(toggle(2).getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses on Escape without losing the place in the list', async () => {
    render(<ListView />);
    fireEvent.click(toggle(1));
    await screen.findByRole('list', { name: 'Merge' });
    fireEvent.keyDown(screen.getByRole('list', { name: 'Merge' }), { key: 'Escape' });
    expect(toggle(1).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle(1));
    expect(cardTitles()).toEqual(['PR number 1', 'PR number 2']);
  });

  it('does not count a card as seen by its expanded height', () => {
    // The observer watches the summary, whose size does not change when the details open.
    render(<ListView />);
    expect(observer().targets.every((el) => el.classList.contains('pr-card__summary'))).toBe(true);
  });
});
