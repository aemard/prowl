import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { buildAuth, buildPullRequest, buildSnapshotOf } from '../../test/panel';
import { pendingActions } from '../state/prActions';
import { openStacks } from '../state/stacks';
import { auth } from '../state/store';
import { StackItem } from './StackItem';
import { toasts } from './ui/Toast';

const ready = { mergeStateStatus: 'clean', reviewDecision: 'approved' } as const;
const member = (position: number, size: number, overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({
    number: 10 + position,
    title: `Part ${position}`,
    stack: { id: 'S7', number: 7, size, position, base: 'main' },
    ...ready,
    ...overrides,
  });

function show(members: PullRequest[], shown = members) {
  const snapshot = buildSnapshotOf({ authored: members });
  return render(
    <ul>
      <StackItem
        members={members}
        shown={shown}
        snapshot={snapshot}
        card={(pr) => <li key={pr.id}>{pr.title}</li>}
      />
    </ul>,
  );
}

/** Answers the merge-async PUT with `status`; records each request. */
function stubMerge(answer: () => Response) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => answer());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const body = (fetch: ReturnType<typeof stubMerge>) =>
  JSON.parse(String(fetch.mock.calls[0]?.[1].body));

describe('StackItem', () => {
  beforeEach(() => {
    auth.value = buildAuth();
  });
  afterEach(() => {
    openStacks.value = [];
    toasts.value = [];
    pendingActions.value = {};
    auth.value = undefined;
    vi.unstubAllGlobals();
  });

  it('renders nothing for pull requests outside a stack', () => {
    const { container } = render(
      <StackItem
        members={[buildPullRequest()]}
        shown={[]}
        snapshot={buildSnapshotOf({})}
        card={() => <li />}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('names a one-PR stack by its title alone, and folds and unfolds its members', () => {
    show([member(1, 1)]);
    expect(document.querySelector('.stack-item__title')?.textContent).toBe('Part 1');
    const toggle = screen.getByRole('button', { name: 'Show the pull requests of stack #7' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const hide = screen.getByRole('button', { name: 'Hide the pull requests of stack #7' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(String(hide.getAttribute('aria-controls')))?.tagName).toBe('OL');
    expect(screen.getByText('main · base of the stack')).toBeTruthy();
    fireEvent.click(hide);
    expect(screen.queryByText('Part 1', { selector: 'li' })).toBeNull();
  });

  it('offers no merge to a viewer who cannot merge, or when the bottom is not ready', () => {
    show([member(1, 2), member(2, 2, { viewerCanMerge: false })]);
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    cleanup();
    show([member(1, 2, { isDraft: true }), member(2, 2)]);
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
  });

  it('merges the whole stack now with the chosen method', async () => {
    const fetch = stubMerge(() => jsonResponse({ status: 'merged' }));
    show([
      member(1, 2, { allowedMergeMethods: ['merge', 'squash'] }),
      member(2, 2, { allowedMergeMethods: ['merge', 'squash'] }),
    ]);
    expect(screen.getByText('The whole stack can merge now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Merge the whole stack' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge 2 pull requests' });
    expect(dialog.textContent).not.toContain('stay open');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Merge method' }), {
      target: { value: 'squash' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge 2 pull requests' }));
    await waitFor(() => expect(toasts.value.at(-1)?.message).toBe('Merged acme/widgets#12'));
    expect(body(fetch)).toMatchObject({ merge_action: 'direct_merge', merge_method: 'squash' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('queues the ready run instead, with no method to choose, and says what GitHub did', async () => {
    const fetch = stubMerge(() => jsonResponse({ status: 'enqueued' }));
    show([
      member(1, 3, { allowedMergeMethods: ['merge', 'squash'] }),
      member(2, 3, { isDraft: true }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Merge 1 of 3' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge 1 pull request' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Add to merge queue' }));
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge 1 pull request' }));
    await waitFor(() =>
      expect(toasts.value.at(-1)?.message).toBe('Added to the merge queue acme/widgets#11'),
    );
    expect(body(fetch)).toEqual({ sha: member(1, 3).headSha, merge_action: 'merge_queue' });
  });

  it('keeps the dialog open with the reason when GitHub refuses, and can be cancelled', async () => {
    stubMerge(() => jsonResponse({ status: 'failed', details: { message: 'Rule says no' } }));
    show([member(1, 1, { allowedMergeMethods: ['rebase'], defaultMergeMethod: 'squash' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Merge the whole stack' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge 1 pull request' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge 1 pull request' }));
    await waitFor(() =>
      expect(toasts.value.at(-1)?.message).toBe('Merge 1 pull request failed: Rule says no'),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
