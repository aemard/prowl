import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import {
  choose,
  commitTitle,
  dialog,
  opener,
  pr,
  resetMergeTest,
  setupMergeTest,
  show,
  stubGitHub,
  toastTexts,
} from './MergeAction.test-support';

describe('auto-merge', () => {
  beforeEach(setupMergeTest);
  afterEach(resetMergeTest);

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
    fireEvent.click(screen.getByRole('button', { name: 'Enable auto-merge acme/widgets#1' }));
    expect(within(dialog()).queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(dialog().textContent).toContain('once its checks and reviews pass');
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
    fireEvent.click(screen.getByRole('button', { name: 'Turn off auto-merge of acme/widgets#1' }));
    await waitFor(() =>
      expect(toastTexts()).toEqual(['success: Auto-merge is off for acme/widgets#1']),
    );
    expect(sent).toEqual([{ operation: 'ProwlDisableAutoMerge', variables: { id: pr.id } }]);
  });
});
