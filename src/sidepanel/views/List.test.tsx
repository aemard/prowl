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
import { activeSectionId, filterQuery, foldedGroups, ListView, showHidden } from './List';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

/** The IntersectionObserver the list creates; `show` plays what the browser would report. */
class FakeObserver {
  static all: FakeObserver[] = [];
  targets: Element[] = [];
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
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
  showHidden.value = false;
  foldedGroups.value = [];
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

  it('shows the section bar with short names, icons and counts, and switches panels', () => {
    render(<ListView />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Mine2', 'Review1', 'StaleCould not load']);
    expect(tabs.map((tab) => tab.title)).toEqual(['Created by me', 'Review requested', 'Stale']);
    expect(tabs.map((tab) => tab.querySelectorAll('svg[aria-hidden="true"]').length)).toEqual([
      1, 1, 2,
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Created by me' }).id).toBe(
      screen.getByRole('tab', { selected: true }).getAttribute('aria-controls'),
    );
    expect(cardTitles()).toEqual(['PR number 1', 'PR number 2']);
    // The filter, then the tabs, then the panel they control.
    const [filter, tablist, panel] = ['searchbox', 'tablist', 'tabpanel'].map((role) =>
      screen.getByRole(role),
    ) as HTMLElement[];
    const follows = (a?: Node, b?: Node) =>
      Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(filter, tablist) && follows(tablist, panel)).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: /^Review/ }));
    expect(cardTitles()).toEqual(['Please review me']);
    expect(screen.getByRole('tabpanel', { name: 'Review requested' })).toBeTruthy();
  });

  it('counts only what matches the filter', () => {
    render(<ListView />);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'review me' } });
    expect(
      screen
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
        .slice(0, 2),
    ).toEqual(['Mine0', 'Review1']);
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
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Mine');
  });

  it('puts the sections past the fourth under "More" and shows the one picked there', () => {
    const extra = ['Bots', 'Docs', 'Infra'].map((label, n) => ({
      id: `custom-${n + 2}`,
      kind: 'custom' as const,
      label,
      enabled: true,
      query: `is:pr ${label}`,
    }));
    withSections(['authored', 'review_requested', 'mentioned', 'assigned']);
    settings.value = { ...settings.value, sections: [...settings.value.sections, ...extra] };
    snapshot.value = buildSnapshotOf({ authored: [pr(1)], 'custom-3': [pr(9, { title: 'Docs' })] });
    render(<ListView />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Mine1',
      'Review0',
      'Mentions0',
      'Assigned0',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'More sections' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Docs 1' }));
    expect(screen.getByRole('button', { name: 'More sections, Docs selected' })).toBeTruthy();
    expect(cardTitles()).toEqual(['Docs']);
    expect(screen.queryByRole('tab', { selected: true })).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Docs' })).toBeTruthy();
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
    const badge = computeBadge(snapshot.value, prLocal.value, 'unseen', settings.value, NOW);
    expect(badge.text).toBe(String(dots.filter(Boolean).length));
  });

  it('does not count a card behind the section bar as on screen', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(49);
    render(<ListView />);
    expect(observer().options).toEqual({ threshold: 0.6, rootMargin: '0px 0px 0px 0px' });

    // Turning a second section on brings the bar, and a new observer that leaves it out.
    act(() => withSections(['authored', 'mentioned']));
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(observer().options?.rootMargin).toBe('0px 0px -49px 0px');
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

describe('pull requests with no recent commit', () => {
  // NOW is 2026-10-06T12:00Z: 34 days and a half after this commit, 4 days after the other.
  const stale = pr(1, { title: 'Old idea', lastCommitAt: '2026-09-02T00:00:00.000Z' });
  const fresh = pr(2, { title: 'Fresh work', lastCommitAt: '2026-10-02T00:00:00.000Z' });
  const toggle = (name: string | RegExp) => screen.getByRole('button', { name });

  beforeEach(() => {
    withSections(['authored', 'review_requested']);
    snapshot.value = buildSnapshotOf({ authored: [stale, fresh], review_requested: [stale] });
  });

  it('leaves them out of the cards and the counts, behind "Show N hidden" at the end', () => {
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

  it('reveals them for the session, saying why, and hides them again', () => {
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
    expect(facts?.textContent).toMatch(
      /Unseen changes\. Hidden from the list: No commit for 34 d$/,
    );
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

  it('counts the hidden ones the quick filter matches', () => {
    render(<ListView />);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'old' } });
    expect(cardTitles()).toEqual([]);
    expect(toggle('Show 1 hidden')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No matches' })).toBeNull();
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'fresh' } });
    expect(screen.queryByRole('button', { name: /hidden/ })).toBeNull();
  });

  it('follows the setting as it changes, and hides nothing with 0', () => {
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

  it('keeps a snoozed one under Snoozed', () => {
    prLocal.value = {
      snoozed: { [stale.id]: new Date(NOW + 3_600_000).toISOString() },
      muted: {},
      seen: {},
    };
    render(<ListView />);
    expect(screen.queryByRole('button', { name: /hidden/ })).toBeNull();
    expect(toggle('Snoozed (1)')).toBeTruthy();
  });

  it('marks a revealed card seen like any other', () => {
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
});

describe('draft and bot pull requests', () => {
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

  it('shows both by default', () => {
    show({});
    expect(cardTitles()).toEqual(['Work in progress', 'Bump vite', 'Bump left-pad', 'Real work']);
    expect(screen.queryByRole('button', { name: /hidden/ })).toBeNull();
  });

  it('hides drafts alone, and the revealed card says Draft once, by its own chip', () => {
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

  it('hides bots alone, saying Bot on the revealed card', () => {
    show({ hideBots: true });
    expect(cardTitles()).toEqual(['Work in progress', 'Real work']);
    fireEvent.click(toggle('Show 2 hidden'));
    expect(reasons()).toEqual(['Bot', 'Bot']);
    const details = within(revealed()).getByRole('button', { name: 'Details for Bump vite' });
    const facts = document.getElementById(details.getAttribute('aria-describedby') ?? '');
    expect(facts?.textContent).toMatch(/Hidden from the list: Bot$/);
  });

  it('puts every reason behind the one button, and follows a change of setting', () => {
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
});

describe('grouped by repository', () => {
  // Newest first: api 2, web 1, web 3, api 4, docs 5.
  const inRepo = (
    number: number,
    name: string,
    updatedAt: string,
    more: Partial<PullRequest> = {},
  ) => pr(number, { repo: repo(name), updatedAt, ...more });
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
  const group = (repoName: string) =>
    screen.getByRole('list', { name: `${repoName} pull requests` });
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

  it('is off until the setting is on: one flat list that names the repository on each card', () => {
    withSections(['authored'], { groupByRepo: false });
    render(<ListView />);
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(cardTitles()).toHaveLength(5);
    expect(document.querySelectorAll('.pr-card__repo-name')).toHaveLength(5);
  });

  it('puts each repository under a header with its count, groups in the order of their first PR', () => {
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
  ])('follows the sort: by %s', (sort, expected) => {
    withSections(['authored'], { groupByRepo: true, sort });
    render(<ListView />);
    expect(headers().map((text) => text?.replace(/\d.*$/, ''))).toEqual(expected);
  });

  it('keeps the order of the sort inside a group, and the section count of cards', () => {
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

  it('folds a group with its button, and unfolds it, without changing any count', () => {
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

  it('remembers what is folded for the session, per section', () => {
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

  it('follows the quick filter: groups without a match go, and the counts are the matches', () => {
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

  it('keeps hidden and snoozed PRs in lists of their own, flat, with the repository on each card', () => {
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

  it('observes only the cards of open groups for the seen mark, and the others once unfolded', () => {
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

  it('shows no empty group for a section whose PRs are all hidden or snoozed', () => {
    const only = inRepo(1, 'acme/web', '2026-10-05T00:00:00.000Z', {
      lastCommitAt: '2026-08-01T00:00:00.000Z',
    });
    snapshot.value = buildSnapshotOf({ authored: [only] });
    render(<ListView />);
    expect(headers()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Show 1 hidden' })).toBeTruthy();
  });

  it('switches with the setting, while the list is open', () => {
    render(<ListView />);
    expect(headers()).toHaveLength(3);
    act(() => {
      settings.value = { ...settings.value, groupByRepo: false };
    });
    expect(headers()).toEqual([]);
    expect(cardTitles()).toHaveLength(5);
  });
});
