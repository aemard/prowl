import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { fakeChrome } from '../../test/chrome';
import { pendingActions } from '../state/prActions';
import { auth } from '../state/store';
import { MergeAction } from './MergeAction';
import {
  choose,
  commitTitle,
  confirm,
  dialog,
  merged,
  method,
  opener,
  poll,
  pr,
  resetMergeTest,
  setupMergeTest,
  show,
  stubGitHub,
  toastTexts,
} from './MergeAction.test-support';
import { toasts } from './ui/Toast';

beforeEach(setupMergeTest);
afterEach(resetMergeTest);

it('when the button shows shows for someone who can merge an open pull request, whoever wrote it', () => {
  show();
  expect(opener().textContent).toBe('Merge');
  show({ author: { login: 'octocat', avatarUrl: '', isBot: false } });
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

it('when the button shows is emphasized only when the pull request is ready to merge', () => {
  const { rerender } = show();
  expect(opener().getAttribute('data-variant')).toBe('primary');
  const blocked: PullRequest = {
    ...pr,
    reviewDecision: 'changes_requested',
    mergeStateStatus: 'blocked',
  };
  rerender(<MergeAction pr={blocked} />);
  expect(opener().getAttribute('data-variant')).toBe('secondary');
});

it.each<[string, Partial<PullRequest>]>([
  ['the viewer cannot merge', { viewerCanMerge: false }],
  ['it is merged', { state: 'merged' }],
  ['it is closed', { state: 'closed' }],
  ['it is a draft', { isDraft: true }],
  ['the repository allows no method', { allowedMergeMethods: [] }],
])('when the button shows is hidden when %s', (_name, overrides) => {
  const { container } = show(overrides);
  expect(container.textContent).toBe('');
});

it('when the button shows is hidden while signed out', () => {
  auth.value = undefined;
  const { container } = show();
  expect(container.textContent).toBe('');
});

it('the confirmation names the pull request and its target branch, and does not merge by itself', () => {
  const sent = stubGitHub(() => jsonResponse({ data: merged }));
  show();
  fireEvent.click(opener());
  expect(dialog().textContent).toContain('Merge acme/widgets#1 into release.');
  expect(dialog().textContent).toContain('Improve the widgets');
  expect(dialog().getAttribute('aria-describedby')).toBeTruthy();
  // A dialog on a destructive action does not put the confirm button under the cursor's Enter.
  expect(document.activeElement).toBe(method());
  expect(sent).toEqual([]);
});

it('the confirmation repeats what still blocks the merge, which the dialog hides on the card', () => {
  show({
    reviewDecision: 'changes_requested',
    reviews: [
      { id: 'R_1', author: 'alice', state: 'changes_requested', submittedAt: pr.updatedAt },
    ],
    mergeable: 'conflicting',
    mergeStateStatus: 'dirty',
  });
  fireEvent.click(opener());
  expect(dialog().textContent).toContain(
    'Not ready: changes requested by alice; conflicts with release.',
  );
});

it('the confirmation says nothing more when the pull request is ready to merge', () => {
  show({ mergeStateStatus: 'clean', mergeable: 'mergeable' });
  fireEvent.click(opener());
  expect(dialog().textContent).not.toContain('Not ready');
});

it('the confirmation lists only the methods the repository allows, starting on its default', () => {
  show({ allowedMergeMethods: ['squash', 'rebase'], defaultMergeMethod: 'rebase' });
  fireEvent.click(opener());
  const options = within(method()).getAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    'Squash and merge',
    'Rebase and merge',
  ]);
  expect((method() as HTMLSelectElement).value).toBe('rebase');
});

it('the confirmation falls back to the first allowed method when the default is not allowed', () => {
  show({ allowedMergeMethods: ['squash'], defaultMergeMethod: 'merge' });
  fireEvent.click(opener());
  expect((method() as HTMLSelectElement).value).toBe('squash');
  expect(within(method()).getAllByRole('option')).toHaveLength(1);
});

it('the confirmation can be cancelled, sending nothing', () => {
  const sent = stubGitHub(() => jsonResponse({ data: merged }));
  show();
  fireEvent.click(opener());
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(opener());
  act(() => {
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(sent).toEqual([]);
});

it('the confirmation takes no commit title for a rebase and says why', () => {
  show({ allowedMergeMethods: ['merge', 'rebase'] });
  fireEvent.click(opener());
  expect(commitTitle()).toBeTruthy();
  choose('rebase');
  expect(within(dialog()).queryByRole('textbox')).toBeNull();
  expect(dialog().textContent).toContain('Commits are kept as they are');
});

it('merging sends the chosen method, the head commit and the title, then toasts and polls', async () => {
  const sent = stubGitHub(() => jsonResponse({ data: merged }));
  const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
  show({ allowedMergeMethods: ['merge', 'squash', 'rebase'], headSha: 'b'.repeat(40) });
  fireEvent.click(opener());
  choose('squash');
  fireEvent.input(commitTitle(), { target: { value: ' Improve widgets (#1) ' } });
  fireEvent.click(confirm());
  await waitFor(() => expect(toastTexts()).toEqual(['success: Merged acme/widgets#1']));
  expect(sent).toEqual([
    {
      operation: 'ProwlMerge',
      variables: {
        id: pr.id,
        method: 'SQUASH',
        oid: 'b'.repeat(40),
        headline: 'Improve widgets (#1)',
      },
    },
  ]);
  expect(send).toHaveBeenCalledWith(poll);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(pendingActions.value).toEqual({});
});

it('merging merges with the default method and no title when nothing was changed', async () => {
  const sent = stubGitHub(() => jsonResponse({ data: merged }));
  show({ defaultMergeMethod: 'squash' });
  fireEvent.click(opener());
  fireEvent.click(confirm());
  await waitFor(() => expect(toasts.value).toHaveLength(1));
  expect(sent[0]?.variables).toEqual({ id: pr.id, method: 'SQUASH', oid: pr.headSha });
});

it('merging cannot be closed, edited or sent twice while it runs', async () => {
  let finish: (response: Response) => void = () => {};
  const sent = stubGitHub(() => new Promise<Response>((resolve) => (finish = resolve)));
  show();
  fireEvent.click(opener());
  fireEvent.click(confirm());
  await waitFor(() => expect(confirm().getAttribute('aria-busy')).toBe('true'));
  expect((method() as HTMLSelectElement).disabled).toBe(true);
  expect((commitTitle() as HTMLInputElement).readOnly).toBe(true);
  expect(
    (within(dialog()).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(confirm());
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
  act(() => {
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(screen.queryByRole('dialog')).not.toBeNull();
  expect(sent).toHaveLength(1);

  await act(async () => finish(jsonResponse({ data: merged })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('merging forgets the title once merged, and keeps the choices after a refusal', async () => {
  let answer = () => jsonResponse({ data: null, errors: [graphqlError('UNPROCESSABLE', 'No')] });
  stubGitHub(() => answer());
  show({ allowedMergeMethods: ['merge', 'squash'] });
  fireEvent.click(opener());
  choose('squash');
  fireEvent.input(commitTitle(), { target: { value: 'Title' } });
  fireEvent.click(confirm());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(opener());
  expect((method() as HTMLSelectElement).value).toBe('squash');
  expect((commitTitle() as HTMLInputElement).value).toBe('Title');

  answer = () => jsonResponse({ data: merged });
  fireEvent.click(confirm());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(opener());
  expect((commitTitle() as HTMLInputElement).value).toBe('');
});

it('when GitHub refuses closes the dialog, shows the reason in a toast, never the token, and refreshes', async () => {
  stubGitHub(() =>
    jsonResponse({
      data: null,
      errors: [
        graphqlError(
          'UNPROCESSABLE',
          'Head branch was modified. Review and try the merge again. ghp_test',
        ),
      ],
    }),
  );
  const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
  show();
  fireEvent.click(opener());
  fireEvent.click(confirm());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(toastTexts()).toEqual([
    'danger: Merge failed: Head branch was modified. Review and try the merge again. [redacted]',
  ]);
  // The head moved, so the panel's copy of the pull request is stale: ask for a fresh one.
  expect(send).toHaveBeenCalledWith(poll);
  expect(pendingActions.value).toEqual({});
  expect(opener().getAttribute('aria-busy')).toBeNull();
});

it('when GitHub refuses explains a merge that GitHub did not carry out', async () => {
  stubGitHub(() => jsonResponse({ data: { mergePullRequest: { pullRequest: null } } }));
  show();
  fireEvent.click(opener());
  fireEvent.click(confirm());
  await waitFor(() => expect(toasts.value).toHaveLength(1));
  expect(toastTexts()).toEqual(['danger: Merge failed: GitHub did not confirm the merge.']);
});

it('next to other actions is disabled while another action of the pull request runs, busy while it merges', () => {
  show();
  act(() => {
    pendingActions.value = { [pr.id]: 'Approve' };
  });
  expect((opener() as HTMLButtonElement).disabled).toBe(true);
  act(() => {
    pendingActions.value = { [pr.id]: 'Merge' };
  });
  expect((opener() as HTMLButtonElement).disabled).toBe(false);
  expect(opener().getAttribute('aria-busy')).toBe('true');
  act(() => {
    pendingActions.value = { PR_other_9: 'Approve' };
  });
  expect((opener() as HTMLButtonElement).disabled).toBe(false);
});
