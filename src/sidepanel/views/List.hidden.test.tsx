import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { expect, it } from 'vitest';
import type { Settings } from '../../lib/model';
import { buildSnapshotOf } from '../../test/panel';
import { prLocal, settings, snapshot } from '../state/store';
import { ListView } from './List';
import { cardTitles, NOW, pr, withSections } from './List.test-support';

it('snoozed and muted pull requests sets snoozed PRs aside behind a toggle and flags muted ones', () => {
  const [one, two] = [pr(1), pr(2)];
  snapshot.value = buildSnapshotOf({ authored: [one, two] });
  prLocal.value = {
    snoozed: { [one.id]: new Date(NOW + 3_600_000).toISOString() },
    muted: { [two.id]: true },
    seen: {},
  };
  render(<ListView />);
  expect(cardTitles()).toEqual(['PR number 2']);
  expect(screen.getByText('Notifications muted')).toBeTruthy();

  const toggle = screen.getByRole('button', { name: 'Snoozed (1)' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const hidden = screen.getByRole('list', { name: 'Snoozed Created by me pull requests' });
  expect(within(hidden).getByRole('link', { name: /^PR number 1/ })).toBeTruthy();
});

it('snoozed and muted pull requests does not call a fully snoozed section empty or filtered out', () => {
  const only = pr(1);
  snapshot.value = buildSnapshotOf({ authored: [only] });
  prLocal.value = {
    snoozed: { [only.id]: new Date(NOW + 60_000).toISOString() },
    muted: {},
    seen: {},
  };
  render(<ListView />);
  expect(screen.queryByRole('heading', { name: 'No matches' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'No pull requests' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Snoozed (1)' })).toBeTruthy();
});

const dependabot = { login: 'dependabot', avatarUrl: '', isBot: true };
const draft = pr(1, { title: 'Work in progress', isDraft: true });
const bot = pr(2, { title: 'Bump vite', author: dependabot });
// 34 days without a commit: all three reasons.
const botDraft = pr(3, {
  title: 'Bump left-pad',
  author: dependabot,
  isDraft: true,
  lastCommitAt: '2026-09-02T00:00:00.000Z',
});
const normal = pr(4, { title: 'Real work' });
// Two sections, so that the bar shows the count. No stale rule unless a test turns it on.
const show = (hide: Partial<Settings>) => {
  withSections(['authored', 'review_requested'], { hideStaleAfterDays: 0, ...hide });
  snapshot.value = buildSnapshotOf({
    authored: [draft, bot, botDraft, normal],
    review_requested: [],
  });
  return render(<ListView />);
};
const toggle = (name: string | RegExp) => screen.getByRole('button', { name });
const revealed = () => screen.getByRole('list', { name: 'Hidden Created by me pull requests' });
const reasons = () =>
  within(revealed())
    .queryAllByTitle('Why it is hidden from the list')
    .map((chip) => chip.textContent);

it('draft and bot pull requests shows both by default', () => {
  show({});
  expect(cardTitles()).toEqual(['Work in progress', 'Bump vite', 'Bump left-pad', 'Real work']);
  expect(screen.queryByRole('button', { name: /hidden/ })).toBeNull();
});

it('draft and bot pull requests hides drafts alone, and the revealed card says Draft once, by its own chip', () => {
  show({ hideDrafts: true });
  expect(cardTitles()).toEqual(['Bump vite', 'Real work']);
  expect(screen.getByRole('tab', { name: /^Mine/ }).textContent).toBe('Mine2');
  fireEvent.click(toggle('Show 2 hidden'));
  expect(within(revealed()).getAllByRole('listitem')).toHaveLength(2);
  expect(within(revealed()).getAllByText('Draft')).toHaveLength(2);
  expect(reasons()).toEqual([]);
  const details = within(revealed()).getByRole('button', {
    name: 'Details for Work in progress',
  });
  const facts = document.getElementById(details.getAttribute('aria-describedby') ?? '');
  expect(facts?.textContent).not.toMatch(/Hidden from the list/);
});

it('draft and bot pull requests hides bots alone, saying Bot on the revealed card', () => {
  show({ hideBots: true });
  expect(cardTitles()).toEqual(['Work in progress', 'Real work']);
  fireEvent.click(toggle('Show 2 hidden'));
  expect(reasons()).toEqual(['Bot', 'Bot']);
  const details = within(revealed()).getByRole('button', { name: 'Details for Bump vite' });
  const facts = document.getElementById(details.getAttribute('aria-describedby') ?? '');
  expect(facts?.textContent).toMatch(/Hidden from the list: Bot$/);
});

it('draft and bot pull requests puts every reason behind the one button, and follows a change of setting', () => {
  show({ hideDrafts: true, hideBots: true, hideStaleAfterDays: 20 });
  expect(cardTitles()).toEqual(['Real work']);
  expect(screen.getAllByRole('button', { name: /hidden/ })).toHaveLength(1);
  fireEvent.click(toggle('Show 3 hidden'));
  expect(cardTitles()).toEqual(['Real work', 'Work in progress', 'Bump vite', 'Bump left-pad']);
  expect(reasons()).toEqual(['Bot', 'Bot, No commit for 34 d']);

  act(() => {
    settings.value = { ...settings.value, hideBots: false };
  });
  expect(cardTitles()).toEqual(['Bump vite', 'Real work', 'Work in progress', 'Bump left-pad']);
  expect(reasons()).toEqual(['No commit for 34 d']);
  expect(toggle('Hide again')).toBeTruthy();
});
