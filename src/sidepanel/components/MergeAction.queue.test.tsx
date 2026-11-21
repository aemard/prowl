import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequestDetail } from '../../lib/model';
import { buildDetail } from '../../test/panel';
import { detailKey, details } from '../state/prDetail';
import {
  pr,
  resetMergeTest,
  setupMergeTest,
  show,
  stubGitHub,
  toastTexts,
} from './MergeAction.test-support';

const withQueue = (mergeQueue: PullRequestDetail['mergeQueue']) => {
  details.value = {
    [pr.id]: { key: detailKey(pr), loading: false, detail: { ...buildDetail(), mergeQueue } },
  };
};

describe('merge queue', () => {
  beforeEach(setupMergeTest);
  afterEach(() => {
    details.value = {};
    resetMergeTest();
  });

  it('adds the pull request to the queue after a confirmation, pinned to the head seen', async () => {
    const sent = stubGitHub(() =>
      jsonResponse({ data: { enqueuePullRequest: { mergeQueueEntry: { position: 3 } } } }),
    );
    withQueue(null);
    show();
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add to merge queue' }));
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

  it('says where a queued pull request stands, and takes it out', async () => {
    const sent = stubGitHub(() =>
      jsonResponse({ data: { dequeuePullRequest: { mergeQueueEntry: { id: 'Q' } } } }),
    );
    withQueue({ position: 2, estimatedSeconds: 125 });
    show();
    expect(screen.getByRole('status').textContent).toBe(
      'In the merge queue: position 2, about 3 min',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove from merge queue' }));
    await waitFor(() => expect(sent.map((s) => s.operation)).toEqual(['ProwlDequeue']));
  });
});
