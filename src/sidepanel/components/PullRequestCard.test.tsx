import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../../lib/model';
import { fakeChrome } from '../../test/chrome';
import { buildPullRequest } from '../../test/panel';
import { PullRequestCard } from './PullRequestCard';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

function renderCard(overrides: Partial<PullRequest> = {}, unseen = false) {
  const pr = buildPullRequest({ title: 'Fix the flaky test', number: 42, ...overrides });
  render(
    <ul>
      <PullRequestCard pr={pr} unseen={unseen} now={NOW} />
    </ul>,
  );
  return document.querySelector('a') as HTMLAnchorElement;
}

describe('PullRequestCard', () => {
  it('is one link to the PR whose name starts with the title and holds the rest', () => {
    const link = renderCard({
      author: { login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/bob' },
      checks: { state: 'failure', total: 3, passed: 2, failed: 1, pending: 0, neutral: 0 },
      reviewDecision: 'changes_requested',
      commentCount: 4,
      unresolvedThreads: 2,
    });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/42');
    const name = link.getAttribute('aria-label') ?? '';
    expect(name.startsWith('Fix the flaky test, acme/widgets#42, by bob.')).toBe(true);
    for (const fact of [
      'Checks failing',
      'Changes requested',
      '2 unresolved threads',
      '4 comments',
    ])
      expect(name).toContain(fact);
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

  it('marks unseen changes with a dot and in the name', () => {
    const seen = renderCard();
    expect(screen.queryByTitle('Unseen changes')).toBeNull();
    expect(seen.getAttribute('aria-label')).not.toContain('Unseen changes');
    document.body.innerHTML = '';

    const unseen = renderCard({}, true);
    expect(screen.getByTitle('Unseen changes')).toBeTruthy();
    expect(unseen.getAttribute('aria-label')).toContain('Unseen changes');
    expect(unseen.closest('li')?.getAttribute('data-unseen')).toBe('true');
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
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain(
      'Labels: bug, needs design, ui, p1, p2',
    );
  });

  it('omits what the PR does not have', () => {
    renderCard({ mergeable: 'unknown', author: null });
    const link = screen.getByRole('link');
    expect(link.querySelector('.pr-card__chips')).toBeNull();
    expect(link.querySelector('.pr-card__labels')).toBeNull();
    expect(link.querySelector('.pr-card__stat')).toBeNull();
    expect(link.querySelector('img')).toBeNull();
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
    expect(link.querySelector('img[src="x"]')).toBeNull();
  });
});
