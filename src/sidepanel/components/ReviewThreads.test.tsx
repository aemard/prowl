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
    expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(1);

    const [box] = screen.getAllByRole('textbox', { name: 'Reply on src/widget.ts:12' });
    fireEvent.input(box as HTMLElement, { target: { value: 'Yes, done.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0] as HTMLElement);
    await waitFor(() => expect(toasts.value.at(-1)?.message).toMatch(/^Replied/));

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeLessThan(5));
    await waitFor(() => expect(reviewThreads.value[pr.id]?.threads).toHaveLength(1));
  });
});
