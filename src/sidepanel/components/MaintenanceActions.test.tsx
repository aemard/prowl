import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { pendingActions } from '../state/prActions';
import { auth } from '../state/store';
import { MaintenanceActions } from './MaintenanceActions';
import { toasts } from './ui/Toast';

const base = buildPullRequest({});
const failing = { ...base.checks, state: 'failure' as const, failed: 2 };
const show = (overrides: Partial<PullRequest> = {}) =>
  render(<MaintenanceActions pr={{ ...base, ...overrides }} />);
const toastTexts = () => toasts.value.map(({ message, tone }) => `${tone}: ${message}`);

beforeEach(() => {
  auth.value = buildAuth('octocat');
});

afterEach(() => {
  auth.value = undefined;
  pendingActions.value = {};
  toasts.value = [];
  vi.unstubAllGlobals();
});

describe('MaintenanceActions', () => {
  it('offers a re-run only for failed checks on an open PR the viewer can write to', () => {
    show({ checks: failing, viewerCanMerge: true });
    expect(screen.getByRole('button', { name: /^Re-run failed checks of / })).toBeTruthy();
    show({
      checks: failing,
      viewerCanMerge: false,
      author: { login: 'someone', avatarUrl: '', isBot: false },
    });
    show({ checks: failing, viewerCanMerge: true, state: 'merged' });
    show({ viewerCanMerge: true });
    expect(screen.getAllByRole('button', { name: /^Re-run/ })).toHaveLength(1);
  });

  it('labels the draft toggle by state, for the author or a writer', () => {
    show({
      isDraft: true,
      viewerCanMerge: false,
      author: { login: 'OctoCat', avatarUrl: '', isBot: false },
    });
    expect(screen.getByRole('button', { name: /^Ready for review: / })).toBeTruthy();
    show({
      isDraft: false,
      viewerCanMerge: true,
      author: { login: 'someone', avatarUrl: '', isBot: false },
    });
    expect(screen.getByRole('button', { name: /^Convert to draft: / })).toBeTruthy();
    show({ viewerCanMerge: false, author: { login: 'someone', avatarUrl: '', isBot: false } });
    expect(screen.getAllByRole('button', { name: /draft|review/ })).toHaveLength(2);
  });

  it('renders nothing when signed out', () => {
    auth.value = undefined;
    const { container } = show({ checks: failing, viewerCanMerge: true });
    expect(container.innerHTML).toBe('');
  });

  it('runs the toggle through GitHub and reports it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ data: { convertPullRequestToDraft: { pullRequest: { isDraft: true } } } }),
      ),
    );
    show({ isDraft: false, viewerCanMerge: true });
    fireEvent.click(screen.getByRole('button', { name: /^Convert to draft: / }));
    await waitFor(() => expect(toastTexts()[0]).toMatch(/^success: Converted to draft:/));
  });

  it('runs a re-run and reports what GitHub refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { node: null } })),
    );
    show({ checks: failing, viewerCanMerge: true });
    fireEvent.click(screen.getByRole('button', { name: /^Re-run failed checks of / }));
    await waitFor(() =>
      expect(toastTexts()[0]).toBe(
        'danger: Re-run failed checks failed: GitHub did not find the pull request.',
      ),
    );
  });
});
