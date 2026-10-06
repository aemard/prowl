import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { pendingActions } from '../state/prActions';
import { auth } from '../state/store';
import { ReviewActions } from './ReviewActions';
import { toasts } from './ui/Toast';

const pr = buildPullRequest();

const approved = { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } };
const commented = { addComment: { commentEdge: { node: { id: 'IC_1' } } } };

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
  render(<ReviewActions pr={{ ...pr, ...overrides }} />);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
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

describe('which buttons show', () => {
  it('offers all three on somebody else’s open pull request', () => {
    show();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Approve',
      'Request changes',
      'Comment',
    ]);
    // Several cards can be open: each name says which pull request it acts on.
    expect(button('Approve acme/widgets#1')).toBeTruthy();
    expect(button('Request changes acme/widgets#1')).toBeTruthy();
    expect(button('Comment on acme/widgets#1')).toBeTruthy();
  });

  it('hides approving and requesting changes on your own pull request, whatever the case', () => {
    show({ author: { login: 'OctoCat', avatarUrl: '' } });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Comment']);
  });

  it('keeps only the comment once the pull request is not open', () => {
    show({ state: 'merged' });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Comment']);
  });

  it('shows both for a pull request whose author account is gone', () => {
    show({ author: null });
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows nothing while signed out', () => {
    auth.value = undefined;
    const { container } = show();
    expect(container.textContent).toBe('');
  });
});

describe('approve', () => {
  it('is one click: no dialog, the mutation, a toast and a forced poll', async () => {
    const sent = stubGitHub(() => jsonResponse({ data: approved }));
    const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
    show();
    fireEvent.click(button('Approve acme/widgets#1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(toastTexts()).toEqual(['success: Approved acme/widgets#1']));
    expect(sent).toEqual([
      { operation: 'ProwlApprove', variables: { id: pr.id, event: 'APPROVE' } },
    ]);
    expect(send).toHaveBeenCalledWith(poll);
    expect(pendingActions.value).toEqual({});
  });

  it('disables the pull request’s buttons while it runs, and ignores a second click', async () => {
    let finish: (response: Response) => void = () => {};
    const sent = stubGitHub(() => new Promise<Response>((resolve) => (finish = resolve)));
    show();
    const approve = button('Approve acme/widgets#1');
    fireEvent.click(approve);
    await waitFor(() => expect(approve.getAttribute('aria-busy')).toBe('true'));
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect((button('Request changes acme/widgets#1') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Comment on acme/widgets#1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(approve);
    expect(sent).toHaveLength(1);

    await act(async () => finish(jsonResponse({ data: approved })));
    await waitFor(() => expect(approve.getAttribute('aria-busy')).toBeNull());
    expect((button('Request changes acme/widgets#1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows GitHub’s reason in a toast, never the token, and does not poll', async () => {
    stubGitHub(() =>
      jsonResponse({
        data: null,
        errors: [graphqlError('UNPROCESSABLE', 'Can not approve your own pull request ghp_test')],
      }),
    );
    const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
    show();
    fireEvent.click(button('Approve acme/widgets#1'));
    await waitFor(() => expect(toasts.value).toHaveLength(1));
    expect(toastTexts()).toEqual([
      'danger: Approve failed: Can not approve your own pull request [redacted]',
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(pendingActions.value).toEqual({});
  });

  it('explains a network failure without what fetch threw', async () => {
    stubGitHub(() => Promise.reject(new TypeError('boom')));
    show();
    fireEvent.click(button('Approve acme/widgets#1'));
    await waitFor(() => expect(toasts.value).toHaveLength(1));
    // The client replaces whatever fetch threw with its own message, so nothing of it leaks.
    expect(toastTexts()).toEqual(['danger: Approve failed: Could not reach GitHub.']);
  });
});

describe('request changes', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Request changes' });
  const message = () => within(dialog()).getByRole('textbox', { name: /Message/ });
  const submit = () => within(dialog()).getByRole('button', { name: 'Request changes' });
  const type = (text: string) => fireEvent.input(message(), { target: { value: text } });

  it('needs a message: asks again inline and sends nothing without one', () => {
    const sent = stubGitHub(() => jsonResponse({ data: approved }));
    show();
    fireEvent.click(button('Request changes acme/widgets#1'));
    expect(dialog().getAttribute('aria-describedby')).toBeTruthy();
    expect(dialog().textContent).toContain('Tell the author what has to change in acme/widgets#1.');
    expect(document.activeElement).toBe(message());

    type('   ');
    fireEvent.click(submit());
    expect(within(dialog()).getByText('Write a message first.')).toBeTruthy();
    expect(message().getAttribute('aria-invalid')).toBe('true');
    expect(sent).toEqual([]);
    type('Please add a test');
    expect(message().getAttribute('aria-invalid')).toBeNull();
  });

  it('sends the trimmed message with the REQUEST_CHANGES event, then closes and polls', async () => {
    const sent = stubGitHub(() => jsonResponse({ data: approved }));
    const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
    show();
    const opener = button('Request changes acme/widgets#1');
    opener.focus();
    fireEvent.click(opener);
    type('  Please add a test  ');
    fireEvent.click(submit());
    await waitFor(() =>
      expect(toastTexts()).toEqual(['success: Requested changes on acme/widgets#1']),
    );
    expect(sent).toEqual([
      {
        operation: 'ProwlRequestChanges',
        variables: { id: pr.id, event: 'REQUEST_CHANGES', body: 'Please add a test' },
      },
    ]);
    expect(send).toHaveBeenCalledWith(poll);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    // What was sent is not offered again.
    fireEvent.click(opener);
    expect((message() as HTMLTextAreaElement).value).toBe('');
  });

  it('cannot be closed or edited while sending', async () => {
    let finish: (response: Response) => void = () => {};
    stubGitHub(() => new Promise<Response>((resolve) => (finish = resolve)));
    show();
    fireEvent.click(button('Request changes acme/widgets#1'));
    type('Not like this');
    fireEvent.click(submit());
    await waitFor(() => expect(submit().getAttribute('aria-busy')).toBe('true'));
    expect((message() as HTMLTextAreaElement).readOnly).toBe(true);
    expect(
      (within(dialog()).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    act(() => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();

    await act(async () => finish(jsonResponse({ data: approved })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('on failure closes the dialog, explains in a toast and keeps the message', async () => {
    stubGitHub(() =>
      jsonResponse(
        { message: 'Resource not accessible by personal access token' },
        { status: 403 },
      ),
    );
    show();
    fireEvent.click(button('Request changes acme/widgets#1'));
    type('Please add a test');
    fireEvent.click(submit());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toastTexts()).toEqual([
      'danger: Request changes failed: Resource not accessible by personal access token',
    ]);

    fireEvent.click(button('Request changes acme/widgets#1'));
    expect((message() as HTMLTextAreaElement).value).toBe('Please add a test');
  });

  it('can be cancelled', () => {
    const sent = stubGitHub(() => jsonResponse({ data: approved }));
    show();
    fireEvent.click(button('Request changes acme/widgets#1'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('comment', () => {
  it('adds a conversation comment from the same kind of dialog', async () => {
    const sent = stubGitHub(() => jsonResponse({ data: commented }));
    const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
    show({ author: { login: 'octocat', avatarUrl: '' } });
    fireEvent.click(button('Comment on acme/widgets#1'));
    const dialog = screen.getByRole('dialog', { name: 'Comment' });
    expect(dialog.textContent).toContain('Add a comment to the conversation of acme/widgets#1.');
    fireEvent.input(within(dialog).getByRole('textbox', { name: /Message/ }), {
      target: { value: 'Thanks for the quick fix!' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(toastTexts()).toEqual(['success: Commented on acme/widgets#1']));
    expect(sent).toEqual([
      { operation: 'ProwlComment', variables: { id: pr.id, body: 'Thanks for the quick fix!' } },
    ]);
    expect(send).toHaveBeenCalledWith(poll);
  });

  it('keeps a separate message for each of the two dialogs', () => {
    stubGitHub(() => jsonResponse({ data: commented }));
    show();
    fireEvent.click(button('Comment on acme/widgets#1'));
    fireEvent.input(screen.getByRole('textbox', { name: /Message/ }), {
      target: { value: 'A comment' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(button('Request changes acme/widgets#1'));
    expect((screen.getByRole('textbox', { name: /Message/ }) as HTMLTextAreaElement).value).toBe(
      '',
    );
  });
});
