import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { buildAuth, buildSnapshotOf } from '../../test/panel';
import { toasts } from '../components/ui/Toast';
import { openStacks } from '../state/stacks';
import { auth, snapshot } from '../state/store';
import { ListView } from './List';
import { pr, withSections } from './List.test-support';

const ready = { mergeStateStatus: 'clean', reviewDecision: 'approved' } as const;
const member = (position: number, overrides: Partial<PullRequest> = {}) =>
  pr(10 + position, {
    title: `Part ${position}`,
    stack: { id: 'S7', number: 7, size: 4, position, base: 'main' },
    ...overrides,
  });

describe('GitHub stacks in the list', () => {
  beforeEach(() => {
    auth.value = buildAuth();
    withSections(['authored']);
    snapshot.value = buildSnapshotOf({
      authored: [
        member(3, { isDraft: true }),
        pr(1, { title: 'On its own' }),
        member(1, ready),
        member(2, ready),
      ],
    });
  });
  afterEach(() => {
    openStacks.value = [];
    toasts.value = [];
    auth.value = undefined;
    vi.unstubAllGlobals();
  });

  it('shows a stack as one item with its counts, and its members only once opened', () => {
    render(<ListView />);
    const stack = document.querySelector<HTMLElement>('.stack-item');
    if (!stack) throw new Error('no stack item');
    expect(
      within(stack).getByText('acme/widgets · stack #7 · 4 pull requests into main'),
    ).toBeTruthy();
    expect(within(stack).getByRole('link', { name: 'Part 1, and 3 more' })).toBeTruthy();
    expect(within(stack).getByRole('img').getAttribute('aria-label')).toBe(
      'Stack #7, bottom to top: 2 Ready, 0 In progress, 0 Blocked, 1 Drafts',
    );
    expect(stack.querySelectorAll('.pr-card')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /^On its own/ })).toBeTruthy();

    fireEvent.click(
      within(stack).getByRole('button', { name: 'Show the pull requests of stack #7' }),
    );
    const cards = [...stack.querySelectorAll<HTMLElement>('.pr-card')];
    expect(cards.map((card) => card.dataset.stackPosition)).toEqual(['3', '2', '1']);
    expect(within(stack).getByText('1 more in this stack is not in your sections.')).toBeTruthy();
  });

  it('merges the ready bottom of the stack through GitHub, after a confirmation', async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: 'merged' }));
    vi.stubGlobal('fetch', fetch);
    render(<ListView />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Merge 2 of 4',
        description: 'Merge the 2 ready pull requests at the bottom of stack #7',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Merge 2 pull requests' });
    expect(dialog.textContent).toContain('The 2 above stay open');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge 2 pull requests' }));
    await waitFor(() => expect(toasts.value.at(-1)?.message).toBe('Merged acme/widgets#12'));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/repos\/acme\/widgets\/pulls\/12\/merge-async$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ merge_action: 'direct_merge' });
  });
});
