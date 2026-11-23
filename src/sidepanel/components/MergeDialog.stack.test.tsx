import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { buildAuth, buildDetail, buildPullRequest } from '../../test/panel';
import { pendingActions } from '../state/prActions';
import { detailKey, details } from '../state/prDetail';
import { auth } from '../state/store';
import { MergeDialog } from './MergeDialog';
import { toasts } from './ui/Toast';

const ready = { mergeStateStatus: 'clean', reviewDecision: 'approved' } as const;
const member = (position: number, overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({
    number: 10 + position,
    title: `Part ${position}`,
    stack: { id: 'S7', number: 7, size: 3, position, base: 'main' },
    allowedMergeMethods: ['merge', 'squash', 'rebase'],
    ...ready,
    ...overrides,
  });

/** The top's detail as the card would have read it; `null` for one that failed to load. */
function withDetail(top: PullRequest, detail: Partial<PullRequestDetail> | null = {}) {
  details.value = {
    [top.id]: detail
      ? { key: detailKey(top), loading: false, detail: buildDetail(detail) }
      : { key: detailKey(top), loading: false, error: 'Boom' },
  };
}

const onClose = vi.fn();
function open(members: PullRequest[], size = 3) {
  const top = members.at(-1) as PullRequest;
  const view = render(
    <MergeDialog target={{ pr: top, stack: { members, open: size } }} onClose={onClose} />,
  );
  return {
    ...view,
    dialog: () => screen.getByRole('dialog'),
    rerender: (next: PullRequest[]) =>
      view.rerender(
        <MergeDialog
          target={{ pr: next.at(-1) as PullRequest, stack: { members: next, open: size } }}
          onClose={onClose}
        />,
      ),
  };
}

function stubMerge(answer: () => Response) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => answer());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const body = (fetch: ReturnType<typeof stubMerge>) =>
  JSON.parse(String(fetch.mock.calls.at(-1)?.[1].body));

describe('MergeDialog for a stack', () => {
  beforeEach(() => {
    auth.value = buildAuth();
  });
  afterEach(() => {
    toasts.value = [];
    pendingActions.value = {};
    details.value = {};
    auth.value = undefined;
    onClose.mockReset();
    vi.unstubAllGlobals();
  });

  it("merges now with a method the base branch's rules allow", async () => {
    const fetch = stubMerge(() => jsonResponse({ status: 'merged' }));
    const members = [member(1), member(2)];
    withDetail(members[1] as PullRequest, { allowedMergeMethods: ['squash', 'rebase'] });
    const { dialog } = open(members);
    const methods = within(dialog()).getByRole('combobox', { name: 'Merge method' });
    expect([...methods.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'squash',
      'rebase',
    ]);
    fireEvent.change(methods, { target: { value: 'rebase' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Merge 2 pull requests' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(body(fetch)).toMatchObject({ merge_action: 'direct_merge', merge_method: 'rebase' });
    expect(toasts.value.at(-1)?.message).toBe('Merged acme/widgets#12');
  });

  it('adds the run to the merge queue when the base branch has one, with no method', async () => {
    const fetch = stubMerge(() => jsonResponse({ status: 'enqueued' }));
    const members = [member(1)];
    withDetail(members[0] as PullRequest, { mergeQueue: null });
    const { dialog } = open(members);
    expect(dialog().textContent).toContain('main merges through a merge queue');
    expect(within(dialog()).queryByRole('combobox')).toBeNull();
    fireEvent.click(
      within(dialog()).getByRole('button', { name: 'Add 1 pull request to the merge queue' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(body(fetch)).toEqual({ sha: member(1).headSha, merge_action: 'merge_queue' });
  });

  it('waits for the base branch facts, and sends to GitHub when they cannot be read', async () => {
    const members = [member(1)];
    stubMerge(() => new Response(null, { status: 500 }));
    const view = open(members);
    expect(screen.getByRole('status').textContent).toBe('Checking how main merges…');
    expect(
      within(view.dialog()).getByRole('button', { name: 'Merge 1 pull request' }),
    ).toHaveProperty('disabled', true);
    view.unmount();
    // Opened again on a detail that failed, it tries once more, then sends to GitHub.
    withDetail(members[0] as PullRequest, null);
    const failed = open(members);
    await waitFor(() =>
      expect(within(failed.dialog()).getByRole('link', { name: 'Merge on GitHub' })).toBeTruthy(),
    );
    expect(
      within(failed.dialog()).getByRole('button', { name: 'Merge 1 pull request' }),
    ).toHaveProperty('disabled', true);
  });

  it('shows why GitHub refused in the dialog, which stays open until cancelled', async () => {
    stubMerge(() => jsonResponse({ status: 'failed', details: { message: 'Rule says no' } }));
    const members = [member(1)];
    withDetail(members[0] as PullRequest);
    const { dialog } = open(members);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Merge 1 pull request' }));
    await waitFor(() =>
      expect(within(dialog()).getByRole('alert').textContent).toBe('Rule says no'),
    );
    expect(toasts.value).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('cannot be dismissed while the merge is sent', () => {
    const members = [member(1)];
    withDetail(members[0] as PullRequest);
    pendingActions.value = { [member(1).id]: 'Merge 1 pull request' };
    const { dialog } = open(members);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses once when a lower head moved since it opened, then merges what it shows', async () => {
    const fetch = stubMerge(() => jsonResponse({ status: 'merged' }));
    const members = [member(1), member(2)];
    withDetail(members[1] as PullRequest);
    const view = open(members);
    view.rerender([member(1, { headSha: 'pushed' }), members[1] as PullRequest]);
    const confirm = () =>
      within(view.dialog()).getByRole('button', { name: 'Merge 2 pull requests' });
    fireEvent.click(confirm());
    expect(within(view.dialog()).getByRole('alert').textContent).toContain('The stack changed');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(confirm());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(body(fetch)).toMatchObject({ sha: member(2).headSha });
  });
});
