import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { threadNode, threadsResponse } from '../../../tests/fixtures/threads';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { reviewThreads } from '../state/reviewThreads';
import { auth } from '../state/store';
import { ReviewThreads } from './ReviewThreads';
import { toasts } from './ui/Toast';

let open = [threadNode('1'), threadNode('2', { isOutdated: true, viewerCanResolve: false })];
const fetch = vi.fn(async (_url: string, init: RequestInit) => {
  const { query } = JSON.parse(String(init.body));
  if (query.includes('ProwlResolveThread')) {
    open = open.slice(1);
    return jsonResponse({
      data: { resolveReviewThread: { thread: { id: '1', isResolved: true } } },
    });
  }
  if (query.includes('ProwlReplyThread'))
    return jsonResponse({ data: { addPullRequestReviewThreadReply: { comment: { id: 'C' } } } });
  return jsonResponse({ data: threadsResponse(open) });
});

describe('ReviewThreads', () => {
  beforeEach(() => {
    auth.value = buildAuth();
    vi.stubGlobal('fetch', fetch);
  });
  afterEach(() => {
    reviewThreads.value = {};
    toasts.value = [];
    auth.value = undefined;
    vi.unstubAllGlobals();
  });

  it('renders nothing without open conversations', () => {
    const { container } = render(<ReviewThreads pr={buildPullRequest()} id="d" />);
    expect(container.innerHTML).toBe('');
  });

  it('loads on demand, then replies and resolves from the card', async () => {
    const pr = buildPullRequest({ unresolvedThreads: 2 });
    render(<ReviewThreads pr={pr} id="d" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 conversations' }));
    const list = await screen.findByRole('list', { name: 'Conversations' });
    expect(list.textContent).toContain('src/widget.ts:12');
    expect(screen.getByText('Outdated')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Resolve conversation on / })).toHaveLength(1);

    const [box] = screen.getAllByRole('textbox', { name: 'Reply on src/widget.ts:12' });
    fireEvent.input(box as HTMLElement, { target: { value: 'Yes, done.' } });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Send reply on src/widget.ts:12' })[0] as HTMLElement,
    );
    await waitFor(() => expect(toasts.value.at(-1)?.message).toMatch(/^Replied/));

    fireEvent.click(
      screen.getByRole('button', { name: 'Resolve conversation on src/widget.ts:12' }),
    );
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeLessThan(5));
    await waitFor(() => expect(reviewThreads.value[pr.id]?.threads).toHaveLength(1));
  });

  it('offers Try again after a failed first load, and loads on it', async () => {
    const pr = buildPullRequest({ unresolvedThreads: 2 });
    reviewThreads.value = {
      [pr.id]: { key: pr.updatedAt, loading: false, error: 'Could not load: offline' },
    };
    render(<ReviewThreads pr={pr} id="d" />);
    expect(screen.getByRole('alert').textContent).toContain('Could not load: offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Conversations' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when every conversation was resolved meanwhile', () => {
    const pr = buildPullRequest({ unresolvedThreads: 1 });
    reviewThreads.value = { [pr.id]: { key: pr.updatedAt, loading: false, threads: [] } };
    render(<ReviewThreads pr={pr} id="d" />);
    expect(screen.getByText('No open conversations.')).toBeTruthy();
  });

  it('says open conversations may be only on GitHub when it could not read them all', () => {
    const pr = buildPullRequest({ unresolvedThreads: 1 });
    reviewThreads.value = {
      [pr.id]: { key: pr.updatedAt, loading: false, threads: [], complete: false },
    };
    render(<ReviewThreads pr={pr} id="d" />);
    expect(screen.queryByText('No open conversations.')).toBeNull();
    expect(screen.getByText(/open ones may be only on GitHub/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View on GitHub' })).toBeTruthy();
  });

  it('reads the conversations again when the pull request changes', async () => {
    const pr = buildPullRequest({ unresolvedThreads: 1 });
    open = [threadNode('7')];
    reviewThreads.value = { [pr.id]: { key: 'earlier', loading: false, threads: [] } };
    render(<ReviewThreads pr={pr} id="d" />);
    await waitFor(() => expect(reviewThreads.value[pr.id]?.threads).toHaveLength(1));
    expect(reviewThreads.value[pr.id]?.key).toBe(pr.updatedAt);
  });

  it('counts the earlier comments, and lets only the replies that may be sent through', async () => {
    open = [
      threadNode('3', {
        line: null,
        viewerCanResolve: false,
        comments: { ...threadNode('3').comments, totalCount: 4 },
      }),
      threadNode('4', { path: 'README.md', viewerCanReply: false, viewerCanResolve: false }),
    ];
    const pr = buildPullRequest({ unresolvedThreads: 2 });
    render(<ReviewThreads pr={pr} id="d" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 conversations' }));
    await screen.findByRole('list', { name: 'Conversations' });
    expect(screen.getByText('3 earlier comments on GitHub')).toBeTruthy();
    // One reply box, for the thread that takes replies; a path without a line names the file.
    const box = screen.getByRole('textbox', { name: 'Reply on src/widget.ts' });
    const reply = screen.getByRole('button', {
      name: 'Send reply on src/widget.ts',
    }) as HTMLButtonElement;
    expect(reply.disabled).toBe(true);
    fireEvent.input(box, { target: { value: '   ' } });
    expect(reply.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Resolve/ })).toBeNull();
  });

  it('shows a refused reply under its thread, and clears it when the text changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        String(init.body).includes('ProwlReplyThread')
          ? jsonResponse({ data: null, errors: [{ type: 'FORBIDDEN', message: 'Locked' }] })
          : jsonResponse({ data: threadsResponse([threadNode('5')]) }),
      ),
    );
    const pr = buildPullRequest({ unresolvedThreads: 1 });
    render(<ReviewThreads pr={pr} id="d" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 conversation' }));
    const box = await screen.findByRole('textbox', { name: 'Reply on src/widget.ts:12' });
    fireEvent.input(box, { target: { value: 'Done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply on src/widget.ts:12' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Locked'));
    fireEvent.input(box, { target: { value: 'Done.' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toasts.value).toEqual([]);
  });

  it('says why Resolve failed on a thread that takes no reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        String(init.body).includes('ProwlResolveThread')
          ? jsonResponse({ data: { resolveReviewThread: { thread: null } } })
          : jsonResponse({ data: threadsResponse([threadNode('6', { viewerCanReply: false })]) }),
      ),
    );
    const pr = buildPullRequest({ unresolvedThreads: 1 });
    render(<ReviewThreads pr={pr} id="d" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 conversation' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Resolve conversation on src/widget.ts:12' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'GitHub did not confirm that the conversation is resolved.',
      ),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
