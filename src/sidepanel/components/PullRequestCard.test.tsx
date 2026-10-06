import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRunNode, detailNode } from '../../../tests/fixtures/github';
import type { PullRequest } from '../../lib/model';
import { fakeChrome } from '../../test/chrome';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { details, expandedIds } from '../state/prDetail';
import { auth } from '../state/store';
import { PullRequestCard } from './PullRequestCard';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

const pr42 = (overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({ title: 'Fix the flaky test', number: 42, ...overrides });

function renderCard(overrides: Partial<PullRequest> = {}, unseen = false) {
  render(
    <ul>
      <PullRequestCard pr={pr42(overrides)} unseen={unseen} now={NOW} />
    </ul>,
  );
  return document.querySelector('a') as HTMLAnchorElement;
}

/** What a screen reader gets from the expand button: its name and description. */
function toggleOf() {
  const button = screen.getByRole('button', { name: /^Details for / });
  const description = document.getElementById(button.getAttribute('aria-describedby') ?? '');
  return { button, description: description?.textContent ?? '' };
}

beforeEach(() => {
  auth.value = buildAuth();
  stubDetailFetch(() => detailNode({ checks: [checkRunNode('lint')] }));
});

afterEach(() => {
  auth.value = undefined;
  expandedIds.value = [];
  details.value = {};
});

describe('PullRequestCard', () => {
  it('has a title link and a separate expand button, each named, and describes the rest', () => {
    const link = renderCard({
      author: { login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/bob' },
      checks: { state: 'failure', total: 3, passed: 2, failed: 1, pending: 0, neutral: 0 },
      reviewDecision: 'changes_requested',
      commentCount: 4,
      unresolvedThreads: 2,
    });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/42');
    expect(screen.getByRole('link', { name: 'Fix the flaky test, acme/widgets#42' })).toBe(link);

    const { button, description } = toggleOf();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();
    expect(description.startsWith('acme/widgets#42, by bob. ')).toBe(true);
    for (const fact of [
      'Checks failing',
      'Changes requested',
      '2 unresolved threads',
      '4 comments',
    ])
      expect(description).toContain(fact);

    // Never nested: each is its own tab stop, and the title link is not inside the button.
    expect(button.contains(link)).toBe(false);
    expect(link.closest('button')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('shows repo, number, author, times, chips and counts as text', () => {
    renderCard({
      checks: { state: 'failure', total: 3, passed: 2, failed: 1, pending: 0, neutral: 0 },
      reviewDecision: 'changes_requested',
      mergeable: 'conflicting',
      isDraft: true,
      commentCount: 4,
      unresolvedThreads: 2,
      updatedAt: '2026-10-06T11:55:00.000Z',
      createdAt: '2026-10-03T12:00:00.000Z',
    });
    expect(screen.getByText('acme/widgets')).toBeTruthy();
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByText('5 min ago').getAttribute('datetime')).toBe('2026-10-06T11:55:00.000Z');
    expect(screen.getByText('Opened 3 d ago')).toBeTruthy();
    for (const chip of ['Draft', '1 failing', 'Changes requested', 'Conflicts'])
      expect(screen.getByText(chip)).toBeTruthy();
    expect(screen.getByText('2 unresolved')).toBeTruthy();
    expect(screen.getByTitle('4 comments').textContent).toBe('4');
    expect(screen.getByTitle('Fix the flaky test').textContent).toBe('Fix the flaky test');
  });

  it('marks unseen changes with a dot and in the description', () => {
    renderCard();
    expect(screen.queryByTitle('Unseen changes')).toBeNull();
    expect(toggleOf().description).not.toContain('Unseen changes');
    expect(document.querySelector('[data-pr-id]')?.getAttribute('data-unseen')).toBeNull();
    document.body.innerHTML = '';

    renderCard({}, true);
    expect(screen.getByTitle('Unseen changes')).toBeTruthy();
    expect(toggleOf().description).toContain('Unseen changes');
    expect(document.querySelector('[data-pr-id]')?.getAttribute('data-unseen')).toBe('true');
  });

  it('colors labels from their own color with readable text, and collapses extras', () => {
    renderCard({
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'needs design', color: 'fbca04' },
        { name: 'ui', color: '0b1f3a' },
        { name: 'p1', color: 'ffffff' },
        { name: 'p2', color: '000000' },
      ],
    });
    const style = (name: string) => screen.getByText(name).getAttribute('style') ?? '';
    expect(style('bug')).toContain('--label-bg: #d73a4a');
    expect(style('bug')).toContain('--label-fg: #ffffff');
    expect(style('needs design')).toContain('--label-fg: #000000');
    expect(screen.queryByText('p1')).toBeNull();
    expect(screen.getByText('+2').getAttribute('title')).toBe('p1, p2');
    expect(toggleOf().description).toContain('Labels: bug, needs design, ui, p1, p2');
  });

  it('omits what the PR does not have', () => {
    renderCard({ mergeable: 'unknown', author: null });
    const card = document.querySelector('.pr-card__summary') as HTMLElement;
    expect(card.querySelector('.pr-card__chips')).toBeNull();
    expect(card.querySelector('.pr-card__labels')).toBeNull();
    expect(card.querySelector('.pr-card__stat')).toBeNull();
    expect(card.querySelector('img')).toBeNull();
  });

  it('opens the PR in a new tab instead of navigating the panel', () => {
    const link = renderCard();
    const proceeded = fireEvent.click(link);
    expect(proceeded).toBe(false);
    expect(fakeChrome().__state.createdTabs).toEqual([
      { url: 'https://github.com/acme/widgets/pull/42' },
    ]);
  });

  it('never links outside GitHub', () => {
    const link = renderCard({ url: 'https://evil.example/acme/widgets/pull/42' });
    expect(link.getAttribute('href')).toBeNull();
    fireEvent.click(link);
    expect(fakeChrome().__state.createdTabs).toEqual([]);
  });

  it('renders untrusted text as text', () => {
    renderCard({ title: '<img src=x onerror=alert(1)>' });
    const link = screen.getByRole('link');
    expect(within(link).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('opens the PR from the title without expanding the card', () => {
    renderCard();
    fireEvent.click(screen.getByRole('link'));
    expect(fakeChrome().__state.createdTabs).toHaveLength(1);
    expect(expandedIds.value).toEqual([]);
  });
});

describe('expanding', () => {
  const expanded = () => toggleOf().button.getAttribute('aria-expanded') === 'true';

  it('opens the details with the button, which then points at them', async () => {
    renderCard();
    expect(screen.queryByRole('list', { name: 'Merge' })).toBeNull();

    fireEvent.click(toggleOf().button);
    expect(expanded()).toBe(true);
    const detail = document.getElementById(toggleOf().button.getAttribute('aria-controls') ?? '');
    expect(detail?.classList.contains('pr-detail')).toBe(true);
    expect(within(detail as HTMLElement).getByRole('list', { name: 'Merge' })).toBeTruthy();
    await screen.findByRole('link', { name: 'lint' });
    expect(document.querySelectorAll('.pr-card__summary')).toHaveLength(1);

    fireEvent.click(toggleOf().button);
    expect(expanded()).toBe(false);
    expect(document.querySelector('.pr-detail')).toBeNull();
    expect(toggleOf().button.getAttribute('aria-controls')).toBeNull();
  });

  it('opens on a click anywhere on the card but its link, button or a selection', () => {
    renderCard();
    fireEvent.click(screen.getByText('acme/widgets'));
    expect(expanded()).toBe(true);
    fireEvent.click(screen.getByText('acme/widgets'));
    expect(expanded()).toBe(false);

    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Fix the' } as Selection);
    fireEvent.click(screen.getByText('acme/widgets'));
    expect(expanded()).toBe(false);
  });

  it('does not react to clicks inside the details', async () => {
    renderCard();
    fireEvent.click(toggleOf().button);
    await screen.findByRole('link', { name: 'lint' });
    fireEvent.click(screen.getByText('Merge', { selector: '.pr-detail__label' }));
    expect(expanded()).toBe(true);
  });

  it('folds back on Escape and keeps focus on the card’s button', async () => {
    renderCard();
    fireEvent.click(toggleOf().button);
    const link = await screen.findByRole('link', { name: 'lint' });
    link.focus();

    fireEvent.keyDown(link, { key: 'Enter' });
    expect(expanded()).toBe(true);
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(expanded()).toBe(false);
    expect(document.activeElement).toBe(toggleOf().button);

    // Nothing to fold: Escape is left alone for whoever else wants it.
    const ignored = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => void toggleOf().button.dispatchEvent(ignored));
    expect(expanded()).toBe(false);
  });

  it('leaves Escape to a dialog opened from the details: closing it keeps the card open', async () => {
    renderCard();
    fireEvent.click(toggleOf().button);
    fireEvent.click(await screen.findByRole('button', { name: 'Comment on acme/widgets#42' }));
    const dialog = screen.getByRole('dialog', { name: 'Comment' });
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' });
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(expanded()).toBe(true);
  });

  it('leaves an Escape that something inside already handled', async () => {
    renderCard();
    fireEvent.click(toggleOf().button);
    const link = await screen.findByRole('link', { name: 'lint' });
    link.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(expanded()).toBe(true);
  });
});
