import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { graphqlError, jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { detailKey, details } from '../state/prDetail';
import { MergeAction } from './MergeAction';
import {
  commitTitle,
  confirm,
  dialog,
  opener,
  pr,
  resetMergeTest,
  setupMergeTest,
  show,
  stubGitHub,
} from './MergeAction.test-support';

beforeEach(setupMergeTest);
afterEach(resetMergeTest);

/** The same PR after a poll brought a comment: only `updatedAt` moved. */
const commented: PullRequest = { ...pr, updatedAt: '2030-01-01T00:00:00Z' };
const title = () => (commitTitle() as HTMLInputElement).value;

describe('a poll while the merge dialog is open', () => {
  it('keeps it open with the edited title, while the detail reloads and once it has', () => {
    const { rerender } = show();
    fireEvent.click(opener());
    fireEvent.input(commitTitle(), { target: { value: 'Widgets, edited' } });
    // The render the poll causes comes before the card asks for the new detail.
    rerender(<MergeAction pr={commented} />);
    expect(title()).toBe('Widgets, edited');
    const kept = details.value[pr.id];
    act(() => {
      details.value = { [pr.id]: { ...kept, key: detailKey(commented), loading: true } };
    });
    expect(title()).toBe('Widgets, edited');
    expect(dialog().contains(document.activeElement)).toBe(true);
    act(() => {
      details.value = { [pr.id]: { ...kept, key: detailKey(commented), loading: false } };
    });
    expect(title()).toBe('Widgets, edited');
  });

  it('keeps the reason GitHub refused, which the refresh it asks for does not clear', async () => {
    stubGitHub(() => jsonResponse({ data: null, errors: [graphqlError('UNPROCESSABLE', 'No')] }));
    const { rerender } = show();
    fireEvent.click(opener());
    fireEvent.click(confirm());
    await waitFor(() => expect(within(dialog()).getByRole('alert').textContent).toBe('No'));
    rerender(<MergeAction pr={commented} />);
    expect(within(dialog()).getByRole('alert').textContent).toBe('No');
  });

  it('closes it when the head moved: what it would merge is not what was shown', () => {
    const { rerender } = show();
    fireEvent.click(opener());
    rerender(<MergeAction pr={{ ...pr, headSha: 'c'.repeat(40) }} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
