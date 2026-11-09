import { act, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { checkRunNode, detailNode } from '../../../tests/fixtures/github';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { details } from '../state/prDetail';
import { auth } from '../state/store';
import { PullRequestDetails } from './PullRequestDetails';

afterEach(() => {
  auth.value = undefined;
  details.value = {};
  vi.restoreAllMocks();
});

it('announces checking once, retains other blockers, then offers GitHub when still unknown', async () => {
  auth.value = buildAuth();
  stubDetailFetch(() => new Promise(() => {}));
  // Other messages may follow the refresh request; finishing answers every pending one.
  const pending: (() => void)[] = [];
  const finish = () => {
    for (const resolve of pending.splice(0)) resolve();
  };
  const send = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  );
  const pr = buildPullRequest({
    isDraft: true,
    mergeable: 'unknown',
    mergeStateStatus: 'unknown',
    reviewDecision: 'changes_requested',
  });
  render(<PullRequestDetails pr={pr} id="detail" />);
  const status = within(screen.getByRole('list', { name: 'Merge status' }));
  expect(status.getByRole('status').textContent).toBe('Checking merge status…');
  expect(status.getByText('Draft')).toBeTruthy();
  expect(status.getByText('Changes requested')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: 'refreshMergeState',
      prId: pr.id,
      headSha: pr.headSha,
    }),
  );
  await act(async () => finish());
  await waitFor(() => expect(status.getByText(/^Merge status unknown/)).toBeTruthy());
  expect(status.queryByRole('status')).toBeNull();
  expect(status.getByRole('link', { name: 'Open on GitHub' })).toBeTruthy();
});

it('orders maintenance before review and auto-merge controls, and omits unknown badges', async () => {
  auth.value = buildAuth();
  stubDetailFetch(() =>
    detailNode({ checks: [checkRunNode('build', 'FAILURE', { isRequired: null })] }),
  );
  const pr = buildPullRequest({
    mergeStateStatus: 'behind',
    viewerCanUpdate: true,
    autoMergeAllowed: true,
    viewerCanEnableAutoMerge: true,
    checks: { state: 'failure', total: 1, passed: 0, failed: 1, pending: 0, neutral: 0 },
  });
  render(<PullRequestDetails pr={pr} id="detail" />);
  const actions = within(screen.getByRole('group', { name: 'Actions for #1' }));
  expect(actions.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Re-run failed',
    'Update branch',
    'Approve',
    'Request changes',
    'Comment',
    'Enable auto-merge',
  ]);
  await waitFor(() => expect(details.value[pr.id]?.loading).toBe(false));
  expect(screen.queryByText('Requirement unknown')).toBeNull();
  expect(screen.queryByText('Merge', { selector: '.pr-detail__label' })).toBeNull();
  expect(screen.queryByText('Actions', { selector: '.pr-detail__label' })).toBeNull();
});
