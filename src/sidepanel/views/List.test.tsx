import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBadge } from '../../lib/badge/computeBadge';
import type { PullRequest, Settings, SortOrder } from '../../lib/model';
import { defaultSettings } from '../../lib/storage/settings';
import { stubDetailFetch } from '../../test/githubFetch';
import {
  buildAuth,
  buildPollState,
  buildPullRequest,
  buildSnapshot,
  buildSnapshotOf,
} from '../../test/panel';
import { details, expandedIds } from '../state/prDetail';
import { auth, pollState, prLocal, settings, snapshot } from '../state/store';
import { activeSectionId, filterQuery, ListView } from './List';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

/** The IntersectionObserver the list creates; `show` plays what the browser would report. */
class FakeObserver {
  static all: FakeObserver[] = [];
  targets: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  disconnect() {
    FakeObserver.all = FakeObserver.all.filter((observer) => observer !== this);
  }
  show(ids: string[]) {
    const entries = this.targets.map((target) => ({
      target,
      isIntersecting: ids.includes((target as HTMLElement).dataset.prId ?? ''),
    }));
    act(() => this.callback(entries as IntersectionObserverEntry[], this as never));
  }
}
const observer = () => FakeObserver.all.at(-1) as FakeObserver;

function withSections(kinds: string[], overrides: Partial<Settings> = {}) {
  const base = defaultSettings();
  settings.value = {
    ...base,
    ...overrides,
    sections: base.sections.map((section) => ({ ...section, enabled: kinds.includes(section.id) })),
  };
}

const repo = (nameWithOwner: string) => {
  const [owner = '', name = ''] = nameWithOwner.split('/');
  return { owner, name, nameWithOwner };
};
const pr = (number: number, overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({ number, title: `PR number ${number}`, ...overrides });

const titles = () => screen.queryAllByRole('link').map((link) => link.textContent);
const cardTitles = () =>
  [...document.querySelectorAll('.pr-card__title')].map((title) => title.textContent);

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  settings.value = defaultSettings();
});

afterEach(() => {
  vi.useRealTimers();
  FakeObserver.all = [];
  settings.value = defaultSettings();
  snapshot.value = undefined;
  pollState.value = undefined;
  prLocal.value = { snoozed: {}, muted: {}, seen: {} };
  activeSectionId.value = undefined;
  filterQuery.value = '';
  location.hash = '';
  auth.value = undefined;
  expandedIds.value = [];
  details.value = {};
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('states without pull requests', () => {
  it('points to Settings when no section is turned on', () => {
    withSections([]);
    render(<ListView />);
    expect(screen.getByRole('heading', { name: 'No sections turned on' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(location.hash).toBe('#/settings');
  });

  it('shows a skeleton while the first poll runs', () => {
    pollState.value = buildPollState({ inFlight: true });
    render(<ListView />);
    const loading = screen.getByRole('status', { name: 'Loading pull requests' });
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says nothing loaded and leaves the reason and the retry to the banner', () => {
    pollState.value = buildPollState({
      lastError: { kind: 'network', message: 'You are offline' },
    });
    render(<ListView />);
    expect(screen.getByRole('heading', { name: 'Could not load pull requests' })).toBeTruthy();
    expect(screen.getByText(/The notice above says why/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the skeleton while a retry is running', () => {
    pollState.value = buildPollState({
      inFlight: true,
      lastError: { kind: 'network', message: 'You are offline' },
    });
    render(<ListView />);
    expect(screen.getByRole('status', { name: 'Loading pull requests' })).toBeTruthy();
  });

  it('explains an empty section for its kind, without a filter box', () => {
    snapshot.value = buildSnapshotOf({ authored: [] });
    render(<ListView />);
    expect(screen.getByRole('heading', { name: 'No pull requests' })).toBeTruthy();
    expect(screen.getByText('Pull requests you open will show up here.')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
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

describe('several sections', () => {
  beforeEach(() => {
    withSections(['authored', 'review_requested', 'custom-1']);
    settings.value = {
      ...settings.value,
      sections: [
        ...settings.value.sections,
        { id: 'custom-1', kind: 'custom', label: 'Stale', enabled: true, query: 'is:pr stale' },
      ],
    };
    snapshot.value = buildSnapshotOf(
      {
        authored: [pr(1), pr(2)],
        review_requested: [pr(3, { title: 'Please review me' })],
      },
      { sectionErrors: { 'custom-1': 'Search failed: validation' } },
    );
  });

  it('shows tabs with counts, the first selected, and switches panels', () => {
    render(<ListView />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Created by me2',
      'Review requested1',
      'StaleCould not load',
    ]);
    const tab = screen.getByRole('tab', { selected: true });
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab.id);
    expect(cardTitles()).toEqual(['PR number 1', 'PR number 2']);

    fireEvent.click(screen.getByRole('tab', { name: /Review requested/ }));
    expect(cardTitles()).toEqual(['Please review me']);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      screen.getByRole('tab', { selected: true }).id,
    );
  });

  it('counts only what matches the filter', () => {
    render(<ListView />);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'review me' } });
    expect(
      screen
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
        .slice(0, 2),
    ).toEqual(['Created by me0', 'Review requested1']);
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();
  });

  it('shows what went wrong in a section that failed instead of an empty state', () => {
    render(<ListView />);
    fireEvent.click(screen.getByRole('tab', { name: /Stale/ }));
    expect(screen.getByText(/Could not load “Stale”: Search failed: validation/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No pull requests' })).toBeNull();
  });

  it('falls back to the first section when the selected one is turned off', () => {
    activeSectionId.value = 'mentioned';
    render(<ListView />);
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Created by me');
  });
});

describe('unseen changes', () => {
  const a = pr(1, { updatedAt: '2026-10-06T10:00:00.000Z' });
  const b = pr(2, { updatedAt: '2026-10-06T09:00:00.000Z' });
  const c = pr(3, { updatedAt: '2026-10-06T08:00:00.000Z' });
  const markSeen = (send: { mock: { calls: unknown[][] } }) =>
    send.mock.calls
      .map(([message]) => message)
      .filter((m) => (m as { type: string }).type === 'markSeen');

  beforeEach(() => {
    snapshot.value = buildSnapshotOf({ authored: [a, b, c] });
    prLocal.value = {
      snoozed: {},
      muted: {},
      seen: { [b.id]: b.updatedAt, [c.id]: '2026-10-05T00:00:00.000Z' },
    };
  });

  it('puts a dot on cards changed since they were seen, as many as the unseen badge counts', () => {
    render(<ListView />);
    const dots = [...document.querySelectorAll('.pr-card__summary')].map((card) =>
      card.getAttribute('data-unseen'),
    );
    expect(dots).toEqual(['true', null, 'true']);
    const badge = computeBadge(snapshot.value, prLocal.value, 'unseen', NOW);
    expect(badge.text).toBe(String(dots.filter(Boolean).length));
  });

  it('marks the unseen cards that stayed on screen for 1.5 s, once', () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    render(<ListView />);
    observer().show([a.id, b.id]);

    act(() => void vi.advanceTimersByTime(1499));
    expect(markSeen(send)).toEqual([]);
    act(() => void vi.advanceTimersByTime(1));
    expect(markSeen(send)).toEqual([{ type: 'markSeen', prIds: [a.id] }]);

    act(() => void vi.advanceTimersByTime(10_000));
    expect(markSeen(send)).toHaveLength(1);
  });

  it('waits again after a scroll, and skips cards that left the screen', () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    render(<ListView />);
    observer().show([a.id]);
    act(() => void vi.advanceTimersByTime(1000));
    observer().show([a.id, c.id]);
    act(() => void vi.advanceTimersByTime(1000));
    expect(markSeen(send)).toEqual([]);
    observer().show([c.id]);
    act(() => void vi.advanceTimersByTime(1500));
    expect(markSeen(send)).toEqual([{ type: 'markSeen', prIds: [c.id] }]);
  });

  it('does nothing while the panel is hidden, and starts when it shows', () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    render(<ListView />);
    observer().show([a.id]);
    act(() => void vi.advanceTimersByTime(5000));
    expect(markSeen(send)).toEqual([]);

    Reflect.deleteProperty(document, 'visibilityState');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(1500));
    expect(markSeen(send)).toEqual([{ type: 'markSeen', prIds: [a.id] }]);
  });

  it('drops the dot once the worker has stored it as seen', () => {
    render(<ListView />);
    act(() => {
      prLocal.value = { ...prLocal.value, seen: { ...prLocal.value.seen, [a.id]: a.updatedAt } };
    });
    expect(document.querySelectorAll('[data-unseen]')).toHaveLength(1);
  });
});

describe('relative times', () => {
  it('keep up with the clock', () => {
    snapshot.value = buildSnapshotOf({
      authored: [pr(1, { updatedAt: '2026-10-06T11:58:00.000Z' })],
    });
    render(<ListView />);
    expect(screen.getByText('2 min ago')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(3 * 60_000));
    expect(screen.getByText('5 min ago')).toBeTruthy();
  });
});

describe('a snapshot with a PR missing', () => {
  it('skips ids that have no pull request', () => {
    const snap = buildSnapshot();
    snap.sections.authored = ['gone'];
    snapshot.value = snap;
    render(<ListView />);
    expect(titles()).toEqual([]);
    expect(screen.getByRole('heading', { name: 'No pull requests' })).toBeTruthy();
  });
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

    fireEvent.click(screen.getByRole('tab', { name: /Review requested/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Created by me/ }));
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

describe('snoozed and muted pull requests', () => {
  it('sets snoozed PRs aside behind a toggle and flags muted ones', () => {
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

  it('does not call a fully snoozed section empty or filtered out', () => {
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
});
