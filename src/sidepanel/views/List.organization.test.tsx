import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequest, Settings, SortOrder } from '../../lib/model';
import { buildSnapshotOf } from '../../test/panel';
import { prLocal, settings, snapshot } from '../state/store';
import { activeSectionId, ListView } from './List';
import { cardTitles, NOW, observer, pr, repo, withSections } from './List.test-support';

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
