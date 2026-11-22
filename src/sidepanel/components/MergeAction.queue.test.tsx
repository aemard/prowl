import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { detailKey, details } from '../state/prDetail';
import { MergeAction } from './MergeAction';
import {
  pr,
  resetMergeTest,
  setupMergeTest,
  show,
  stubGitHub,
  toastTexts,
} from './MergeAction.test-support';

/** Shows the merge control of `pr` with `overrides` on a branch with a merge queue. */
const onQueue = (
  queue: PullRequestDetail['mergeQueue'],
  overrides: Partial<PullRequest> = {},
  placement?: 'merge' | 'auto',
) => {
  cleanup();
  show(overrides, { mergeQueue: queue }, placement);
};
const waiting = {
  autoMergeAllowed: true,
  viewerCanEnableAutoMerge: true,
  mergeStateStatus: 'blocked' as const,
  checks: { state: 'pending' as const, total: 1, passed: 0, failed: 0, pending: 1, neutral: 0 },
};
const buttons = () => screen.queryAllByRole('button').map(({ textContent }) => textContent);

describe('merge queue', () => {
  beforeEach(setupMergeTest);
  afterEach(resetMergeTest);

  it('adds a ready pull request to the queue after a confirmation, pinned to the head seen', async () => {
    const sent = stubGitHub(() =>
      jsonResponse({ data: { enqueuePullRequest: { mergeQueueEntry: { position: 3 } } } }),
    );
    onQueue(null);
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add to merge queue acme/widgets#1' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to merge queue' });
    expect(dialog.textContent).toContain('into release');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to merge queue' }));
    await waitFor(() =>
      expect(toastTexts()).toEqual(['success: Added to the merge queue acme/widgets#1']),
    );
    expect(sent).toEqual([
      { operation: 'ProwlEnqueue', variables: { id: pr.id, oid: pr.headSha } },
    ]);
  });

  it('keeps the confirmation open with the reason when GitHub refuses', async () => {
    stubGitHub(() =>
      jsonResponse({ data: null, errors: [graphqlError('UNPROCESSABLE', 'Queue is full')] }),
    );
    onQueue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Add to merge queue acme/widgets#1' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to merge queue' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to merge queue' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toBe('Queue is full'),
    );
    expect(toastTexts()).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('can be cancelled, sending nothing', () => {
    const sent = stubGitHub(() => jsonResponse({ data: {} }));
    onQueue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Add to merge queue acme/widgets#1' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to merge queue' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent).toEqual([]);
  });

  it.each([
    ['red CI', { mergeStateStatus: 'blocked' as const }],
    ['conflicts', { mergeable: 'conflicting' as const, mergeStateStatus: 'dirty' as const }],
    ['changes requested', { reviewDecision: 'changes_requested' as const }],
    ['unverified merge facts', { mergeable: 'unknown' as const }],
  ])('offers no "Add to merge queue" with %s, even to an admin', (_, overrides) => {
    onQueue(null, { ...overrides, viewerCanMergeAsAdmin: true });
    expect(buttons()).toEqual([]);
  });

  it('offers "Merge when ready" while checks run, which turns on auto-merge', async () => {
    const sent = stubGitHub(() =>
      jsonResponse({
        data: {
          enablePullRequestAutoMerge: {
            pullRequest: { autoMergeRequest: { mergeMethod: 'MERGE' } },
          },
        },
      }),
    );
    onQueue(null, waiting);
    expect(buttons()).toEqual(['Merge when ready']);
    fireEvent.click(screen.getByRole('button', { name: 'Merge when ready acme/widgets#1' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge when ready' });
    expect(dialog.textContent).toContain(
      'GitHub adds acme/widgets#1 to the merge queue of release once its checks and reviews pass.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge when ready' }));
    await waitFor(() =>
      expect(toastTexts()).toEqual(['success: Auto-merge is on for acme/widgets#1']),
    );
    expect(sent).toEqual([
      {
        operation: 'ProwlEnableAutoMerge',
        variables: { id: pr.id, method: 'MERGE', oid: pr.headSha },
      },
    ]);
  });

  it('places "Add" before the review actions and "Merge when ready" after them', () => {
    onQueue(null, {}, 'auto');
    expect(buttons()).toEqual([]);
    onQueue(null, waiting, 'merge');
    expect(buttons()).toEqual([]);
    onQueue(null, waiting, 'auto');
    expect(buttons()).toEqual(['Merge when ready']);
  });

  it('turns auto-merge off on a queue branch too', () => {
    onQueue(
      null,
      {
        ...waiting,
        autoMerge: { method: 'merge', enabledBy: 'octocat' },
        viewerCanDisableAutoMerge: true,
      },
      'auto',
    );
    expect(buttons()).toEqual(['Turn off auto-merge']);
  });

  it('says where a queued pull request stands, and takes it out', async () => {
    const sent = stubGitHub(() =>
      jsonResponse({ data: { dequeuePullRequest: { mergeQueueEntry: { id: 'Q' } } } }),
    );
    onQueue({ position: 2, estimatedSeconds: 125 });
    expect(screen.getByRole('status').textContent).toBe(
      'In the merge queue: position 2, about 3 min',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove from merge queue acme/widgets#1' }));
    await waitFor(() => expect(sent.map((s) => s.operation)).toEqual(['ProwlDequeue']));
  });

  it('gives the position alone when GitHub has no estimate, and nothing after the reviews', () => {
    onQueue({ position: 1, estimatedSeconds: null });
    expect(screen.getByRole('status').textContent).toBe('In the merge queue: position 1');
    onQueue({ position: 1, estimatedSeconds: null }, {}, 'auto');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('before the detail says whether a queue applies', () => {
  beforeEach(setupMergeTest);
  afterEach(resetMergeTest);

  it('offers no merge while the detail loads', () => {
    details.value = { [pr.id]: { key: detailKey(pr), loading: true } };
    render(<MergeAction pr={pr} />);
    expect(buttons()).toEqual([]);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sends to GitHub when the detail could not be read', () => {
    details.value = { [pr.id]: { key: detailKey(pr), loading: false, error: 'Offline' } };
    render(<MergeAction pr={pr} placement="merge" />);
    expect(buttons()).toEqual([]);
    expect(screen.getByRole('link', { name: 'Merge on GitHub' }).getAttribute('href')).toBe(pr.url);
  });
});
