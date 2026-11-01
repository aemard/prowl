import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildSnapshotOf } from '../../test/panel';
import { prLocal, settings, snapshot } from '../state/store';
import { ListView } from './List';
import { cardTitles, NOW, observer, pr, withSections } from './List.test-support';

// NOW is 2026-10-06T12:00Z: 34 days and a half after this commit, 4 days after the other.
const stale = pr(1, { title: 'Old idea', lastCommitAt: '2026-09-02T00:00:00.000Z' });
const fresh = pr(2, { title: 'Fresh work', lastCommitAt: '2026-10-02T00:00:00.000Z' });
const toggle = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  withSections(['authored', 'review_requested']);
  snapshot.value = buildSnapshotOf({ authored: [stale, fresh], review_requested: [stale] });
});

it('pull requests with no recent commit leaves them out of the cards and the counts, behind "Show N hidden" at the end', () => {
  render(<ListView />);
  expect(cardTitles()).toEqual(['Fresh work']);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Mine1', 'Review0']);
  const show = toggle('Show 1 hidden');
  expect(show.getAttribute('aria-expanded')).toBe('false');
  const panel = screen.getByRole('tabpanel');
  expect(panel.lastElementChild?.contains(show)).toBe(true);
  // A section of hidden PRs only is neither empty nor filtered out.
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }));
  expect(cardTitles()).toEqual([]);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(toggle('Show 1 hidden')).toBeTruthy();
});

it('pull requests with no recent commit reveals them for the session, saying why, and hides them again', () => {
  const { unmount } = render(<ListView />);
  fireEvent.click(toggle('Show 1 hidden'));
  const again = toggle('Hide again');
  expect(again.getAttribute('aria-expanded')).toBe('true');
  const revealed = screen.getByRole('list', { name: 'Hidden Created by me pull requests' });
  expect(within(revealed).getByRole('link', { name: /^Old idea/ })).toBeTruthy();
  expect(within(revealed).getByTitle('Why it is hidden from the list').textContent).toBe(
    'No commit for 34 d',
  );
  const details = within(revealed).getByRole('button', { name: 'Details for Old idea' });
  expect(details.getAttribute('aria-describedby')).toBeTruthy();
  const facts = document.getElementById(details.getAttribute('aria-describedby') ?? '');
  expect(facts?.textContent).toMatch(/Unseen changes\. Hidden from the list: No commit for 34 d$/);
  // Still not counted, and the main list does not say why anything is hidden.
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Mine1');
  const main = screen.getByRole('list', { name: 'Created by me pull requests' });
  expect(main.textContent).not.toMatch(/No commit|Hidden/);

  // Revealed until the panel closes: across sections and a visit to Settings.
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }));
  expect(cardTitles()).toEqual(['Old idea']);
  unmount();
  render(<ListView />);
  expect(cardTitles()).toEqual(['Old idea']);

  fireEvent.click(toggle('Hide again'));
  expect(cardTitles()).toEqual([]);
  expect(toggle('Show 1 hidden').getAttribute('aria-expanded')).toBe('false');
});

it('pull requests with no recent commit counts the hidden ones the quick filter matches', () => {
  render(<ListView />);
  fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'old' } });
  expect(cardTitles()).toEqual([]);
  expect(toggle('Show 1 hidden')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'No matches' })).toBeNull();
  fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'fresh' } });
  expect(screen.queryByRole('button', { name: /hidden/ })).toBeNull();
});

it('pull requests with no recent commit follows the setting as it changes, and hides nothing with 0', () => {
  render(<ListView />);
  act(() => {
    settings.value = { ...settings.value, hideStaleAfterDays: 35 };
  });
  expect(cardTitles()).toEqual(['Old idea', 'Fresh work']);
  act(() => {
    settings.value = { ...settings.value, hideStaleAfterDays: 3 };
  });
  expect(cardTitles()).toEqual([]);
  expect(toggle('Show 2 hidden')).toBeTruthy();
  act(() => {
    settings.value = { ...settings.value, hideStaleAfterDays: 0 };
  });
  expect(cardTitles()).toEqual(['Old idea', 'Fresh work']);
  expect(screen.queryByRole('button', { name: /hidden/ })).toBeNull();
});

it('pull requests with no recent commit keeps a snoozed one under Snoozed', () => {
  prLocal.value = {
    snoozed: { [stale.id]: new Date(NOW + 3_600_000).toISOString() },
    muted: {},
    seen: {},
  };
  render(<ListView />);
  expect(screen.queryByRole('button', { name: /hidden/ })).toBeNull();
  expect(toggle('Snoozed (1)')).toBeTruthy();
});

it('pull requests with no recent commit marks a revealed card seen like any other', () => {
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  render(<ListView />);
  fireEvent.click(toggle('Show 1 hidden'));
  expect(document.querySelector(`[data-pr-id="${stale.id}"]`)?.getAttribute('data-unseen')).toBe(
    'true',
  );
  observer().show([stale.id]);
  act(() => void vi.advanceTimersByTime(1500));
  expect(send).toHaveBeenCalledWith({ type: 'markSeen', prIds: [stale.id] });
});
