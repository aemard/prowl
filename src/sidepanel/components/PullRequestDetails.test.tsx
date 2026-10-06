import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkRunNode,
  detailNode,
  detailReview,
  requestedReviewer,
  statusContextNode,
} from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { fakeChrome } from '../../test/chrome';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { details } from '../state/prDetail';
import { auth } from '../state/store';
import { PullRequestDetails } from './PullRequestDetails';

const pr = buildPullRequest({
  reviewDecision: 'review_required',
  mergeStateStatus: 'blocked',
  mergeable: 'conflicting',
  checks: { state: 'failure', total: 4, passed: 2, failed: 1, pending: 1, neutral: 0 },
});

const show = (overrides: Partial<PullRequest> = {}) =>
  render(<PullRequestDetails pr={{ ...pr, ...overrides }} id="detail" />);

beforeEach(() => {
  auth.value = buildAuth();
});

afterEach(() => {
  auth.value = undefined;
  details.value = {};
});

const list = (name: string) => within(screen.getByRole('list', { name }));
const rows = (name: string) =>
  list(name)
    .getAllByRole('listitem')
    .map((row) => row.textContent);

describe('PullRequestDetails', () => {
  it('offers the actions at once, before the details have loaded', () => {
    stubDetailFetch(() => new Promise(() => {}));
    show();
    expect(screen.getByText('Actions')).toBeTruthy();
    expect(
      screen
        .getAllByRole('button', { name: /acme\/widgets#1$/ })
        .map((button) => button.textContent),
    ).toEqual(['Approve', 'Request changes', 'Comment', 'Merge']);
  });

  it('says why it cannot be merged at once, then fills in checks and reviewers', async () => {
    stubDetailFetch(() =>
      detailNode({
        checks: [
          checkRunNode('lint'),
          checkRunNode('build', 'FAILURE', { isRequired: true }),
          checkRunNode('e2e', 'IN_PROGRESS'),
          statusContextNode('ci/legacy', 'SUCCESS'),
          checkRunNode('docs', 'SKIPPED'),
        ],
        latestReviews: { nodes: [detailReview('alice', 'CHANGES_REQUESTED')] },
        reviewRequests: { nodes: [requestedReviewer('bob')] },
      }),
    );
    const { container } = show();

    // Before the answer: the merge facts from the list, a status for assistive tech, no lists.
    expect(rows('Merge')).toEqual([
      'Blocked: review required',
      'Conflicts with main',
      'Blocked: 1 check failing',
      'Waiting for 1 check to finish',
    ]);
    expect(screen.getByRole('status').textContent).toBe('Loading checks and reviewers');
    expect(screen.queryByRole('list', { name: 'Checks' })).toBeNull();

    await screen.findByRole('list', { name: 'Checks' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(rows('Merge')).toEqual([
      'Blocked: 1 approval required',
      'Conflicts with main',
      'Blocked: 1 required check failing',
    ]);
    // Failed first, then pending; what passed folds away, each state with a word, not color alone.
    expect(rows('Checks')).toEqual(['buildRequiredFailed', 'e2ePending']);
    const folded = container.querySelector('details');
    expect(folded?.open).toBe(false);
    expect(folded?.querySelector('summary')?.textContent).toBe('2 passed, 1 skipped');
    expect([...(folded?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'lintPassed',
      'ci/legacyPassed',
      'docsSkipped',
    ]);
    expect(rows('Reviewers')).toEqual(['aliceChanges requested', 'bobReview requested']);
  });

  it('links each check to its page on GitHub, and leaves other hosts as plain text', async () => {
    stubDetailFetch(() =>
      detailNode({
        checks: [
          checkRunNode('build', 'FAILURE'),
          statusContextNode('ci/jenkins', 'ERROR', { targetUrl: 'https://jenkins.example/job/1' }),
          checkRunNode('nolink', 'FAILURE', { detailsUrl: null }),
        ],
      }),
    );
    show();
    const link = await screen.findByRole('link', { name: 'build' });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/acme/widgets/actions/runs/1/job/build',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('ci/jenkins').getAttribute('href')).toBeNull();
    expect(screen.getByText('nolink').closest('a')).toBeNull();

    expect(fireEvent.click(link)).toBe(false);
    expect(fakeChrome().__state.createdTabs).toEqual([
      { url: 'https://github.com/acme/widgets/actions/runs/1/job/build' },
    ]);
  });

  it('names reviewers with avatars, or a placeholder for a deleted account', async () => {
    stubDetailFetch(() =>
      detailNode({
        latestReviews: {
          nodes: [detailReview('alice', 'APPROVED'), detailReview(null, 'COMMENTED')],
        },
      }),
    );
    const { container } = show();
    await screen.findByRole('list', { name: 'Reviewers' });
    expect(rows('Reviewers')).toEqual(['aliceApproved', 'ghostCommented']);
    const avatars = container.querySelectorAll('.pr-detail__group:last-child .ui-avatar');
    expect(avatars[0]?.tagName).toBe('IMG');
    expect(avatars[1]?.tagName).toBe('SPAN');
  });

  it('says so when there is nothing to list', async () => {
    stubDetailFetch(() => detailNode());
    show({ checks: { state: 'none', total: 0, passed: 0, failed: 0, pending: 0, neutral: 0 } });
    await screen.findByText('No checks on the latest commit.');
    expect(screen.getByText('No reviews yet.')).toBeTruthy();
  });

  it('explains checks that GitHub did not return although the PR has some', async () => {
    stubDetailFetch(() => detailNode({ checks: [null] }));
    show();
    await screen.findByText(/did not return the checks/);
  });

  it('points to GitHub for checks beyond the ones it read', async () => {
    stubDetailFetch(({ after }) =>
      detailNode({
        checks: Array.from({ length: 600 }, (_, i) => checkRunNode(`job-${i}`, 'FAILURE')),
        after,
      }),
    );
    show();
    const more = await screen.findByRole('link', { name: 'on GitHub' });
    expect(more.parentElement?.textContent).toBe('100 more checks on GitHub');
    expect(more.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/1/checks');
  });

  it('reports a failure with GitHub’s words and loads again on Try again', async () => {
    stubDetailFetch(() => jsonResponse({ message: 'Server error' }, { status: 502 }));
    show();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server error');
    // The merge facts and no skeleton stay: nothing more to wait for.
    expect(rows('Merge')[0]).toBe('Blocked: review required');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Checks')).toBeNull();

    const fetch = stubDetailFetch(() => detailNode({ checks: [checkRunNode('lint')] }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Checks');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('loads again when the PR changes, keeping what it shows meanwhile', async () => {
    const fetch = stubDetailFetch(() => detailNode({ checks: [checkRunNode('lint')] }));
    const { rerender } = show();
    await waitFor(() => expect(details.value[pr.id]?.detail).toBeDefined());
    expect(fetch).toHaveBeenCalledTimes(1);

    rerender(<PullRequestDetails pr={{ ...pr, fetchedLater: true } as PullRequest} id="detail" />);
    expect(fetch).toHaveBeenCalledTimes(1);

    rerender(
      <PullRequestDetails pr={{ ...pr, updatedAt: '2026-10-07T00:00:00.000Z' }} id="detail" />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('list', { name: 'Merge' })).toBeTruthy();
  });
});
