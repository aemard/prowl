import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { pendingActions } from '../state/prActions';
import { auth } from '../state/store';
import { MergeAction } from './MergeAction';
import { toasts } from './ui/Toast';

const pr = buildPullRequest({ title: 'Improve the widgets', baseRefName: 'release' });
const merged = { mergePullRequest: { pullRequest: { merged: true } } };

interface Sent {
  operation: string;
  variables: Record<string, unknown>;
}

/** Stubs `fetch`: `answer(sent)` for each GraphQL request, which is recorded in `sent`. */
function stubGitHub(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body));
      const request = { operation: /mutation (\w+)/.exec(query)?.[1] ?? '', variables };
      sent.push(request);
      return answer(request);
    }),
  );
  return sent;
}

const show = (overrides: Partial<PullRequest> = {}) =>
  render(<MergeAction pr={{ ...pr, ...overrides }} />);
const opener = () => screen.getByRole('button', { name: 'Merge acme/widgets#1' });
const dialog = () => screen.getByRole('dialog', { name: 'Merge pull request' });
const method = () => within(dialog()).getByRole('combobox', { name: 'Merge method' });
const commitTitle = () => within(dialog()).getByRole('textbox', { name: /Commit title/ });
const confirm = () => within(dialog()).getByRole('button', { name: 'Merge' });
const choose = (value: string) => fireEvent.change(method(), { target: { value } });
const toastTexts = () => toasts.value.map(({ message, tone }) => `${tone}: ${message}`);
const poll = { type: 'poll', force: true };

beforeEach(() => {
  auth.value = buildAuth('octocat');
});

afterEach(() => {
  auth.value = undefined;
  pendingActions.value = {};
  toasts.value = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('when the button shows', () => {
  it('shows for someone who can merge an open pull request, whoever wrote it', () => {
    show();
    expect(opener().textContent).toBe('Merge');
    show({ author: { login: 'octocat', avatarUrl: '', isBot: false } });
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('is emphasized only when the pull request is ready to merge', () => {
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
  ])('is hidden when %s', (_name, overrides) => {
    const { container } = show(overrides);
    expect(container.textContent).toBe('');
  });

  it('is hidden while signed out', () => {
    auth.value = undefined;
    const { container } = show();
    expect(container.textContent).toBe('');
  });
});

describe('the confirmation', () => {
  it('names the pull request and its target branch, and does not merge by itself', () => {
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

  it('lists only the methods the repository allows, starting on its default', () => {
    show({ allowedMergeMethods: ['squash', 'rebase'], defaultMergeMethod: 'rebase' });
    fireEvent.click(opener());
    const options = within(method()).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Squash and merge',
      'Rebase and merge',
    ]);
    expect((method() as HTMLSelectElement).value).toBe('rebase');
  });

  it('falls back to the first allowed method when the default is not allowed', () => {
    show({ allowedMergeMethods: ['squash'], defaultMergeMethod: 'merge' });
    fireEvent.click(opener());
    expect((method() as HTMLSelectElement).value).toBe('squash');
    expect(within(method()).getAllByRole('option')).toHaveLength(1);
  });

  it('can be cancelled, sending nothing', () => {
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

  it('takes no commit title for a rebase and says why', () => {
    show({ allowedMergeMethods: ['merge', 'rebase'] });
    fireEvent.click(opener());
    expect(commitTitle()).toBeTruthy();
    choose('rebase');
    expect(within(dialog()).queryByRole('textbox')).toBeNull();
    expect(dialog().textContent).toContain('Commits are kept as they are');
  });
});

describe('merging', () => {
  it('sends the chosen method, the head commit and the title, then toasts and polls', async () => {
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

  it('merges with the default method and no title when nothing was changed', async () => {
    const sent = stubGitHub(() => jsonResponse({ data: merged }));
    show({ defaultMergeMethod: 'squash' });
    fireEvent.click(opener());
    fireEvent.click(confirm());
    await waitFor(() => expect(toasts.value).toHaveLength(1));
    expect(sent[0]?.variables).toEqual({ id: pr.id, method: 'SQUASH', oid: pr.headSha });
  });

  it('cannot be closed, edited or sent twice while it runs', async () => {
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

  it('forgets the title once merged, and keeps the choices after a refusal', async () => {
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
});

describe('when GitHub refuses', () => {
  it('closes the dialog, shows the reason in a toast, never the token, and refreshes', async () => {
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

  it('explains a merge that GitHub did not carry out', async () => {
    stubGitHub(() => jsonResponse({ data: { mergePullRequest: { pullRequest: null } } }));
    show();
    fireEvent.click(opener());
    fireEvent.click(confirm());
    await waitFor(() => expect(toasts.value).toHaveLength(1));
    expect(toastTexts()).toEqual(['danger: Merge failed: GitHub did not confirm the merge.']);
  });
});

describe('next to other actions', () => {
  it('is disabled while another action of the pull request runs, busy while it merges', () => {
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
});

describe('auto-merge', () => {
  const blocked = {
    autoMergeAllowed: true,
    mergeStateStatus: 'blocked' as const,
    reviewDecision: 'review_required' as const,
  };

  it('offers to merge once checks and reviews pass, with the chosen method and title', async () => {
    const sent = stubGitHub(() =>
      jsonResponse({
        data: {
          enablePullRequestAutoMerge: {
            pullRequest: { autoMergeRequest: { mergeMethod: 'SQUASH' } },
          },
        },
      }),
    );
    show(blocked);
    fireEvent.click(opener());
    expect(dialog().textContent).toContain(
      'or let GitHub merge it once its checks and reviews pass',
    );
    choose('squash');
    fireEvent.input(commitTitle(), { target: { value: 'Widgets, improved' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Enable auto-merge' }));
    await waitFor(() =>
      expect(toastTexts()).toEqual(['success: Auto-merge is on for acme/widgets#1']),
    );
    expect(sent).toEqual([
      {
        operation: 'ProwlEnableAutoMerge',
        variables: { id: pr.id, method: 'SQUASH', oid: pr.headSha, headline: 'Widgets, improved' },
      },
    ]);
  });

  it('is not offered when the repository does not allow it or the PR is ready to merge', () => {
    show({ autoMergeAllowed: false });
    fireEvent.click(opener());
    expect(within(dialog()).queryByRole('button', { name: 'Enable auto-merge' })).toBeNull();
  });

  it('turns auto-merge off from the actions row', async () => {
    const sent = stubGitHub(() =>
      jsonResponse({
        data: { disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } },
      }),
    );
    show({ ...blocked, autoMerge: { method: 'merge', enabledBy: 'octocat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Disable auto-merge of acme/widgets#1' }));
    await waitFor(() =>
      expect(toastTexts()).toEqual(['success: Auto-merge is off for acme/widgets#1']),
    );
    expect(sent).toEqual([{ operation: 'ProwlDisableAutoMerge', variables: { id: pr.id } }]);
  });
});
