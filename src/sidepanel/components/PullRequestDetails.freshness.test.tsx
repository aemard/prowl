import { render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRunNode, detailNode, detailResponse } from '../../../tests/fixtures/github';
import { jsonResponse } from '../../../tests/fixtures/http';
import type { PullRequest } from '../../lib/model';
import { stubDetailFetch } from '../../test/githubFetch';
import { buildAuth, buildPullRequest, buildSnapshotOf } from '../../test/panel';
import { details } from '../state/prDetail';
import { auth, snapshot } from '../state/store';
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
  snapshot.value = undefined;
});

it('does not display old-head checks while a new-head detail request is pending', async () => {
  stubDetailFetch(() => detailNode({ checks: [checkRunNode('old-head-check')] }));
  const view = show();
  await screen.findByText('old-head-check');
  let release: (response: Response) => void = () => {};
  stubDetailFetch(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  view.rerender(<PullRequestDetails pr={{ ...pr, headSha: 'b'.repeat(40) }} id="detail" />);
  await waitFor(() => expect(screen.queryByText('old-head-check')).toBeNull());
  release(
    jsonResponse({
      data: detailResponse(detailNode({ checks: [checkRunNode('new-head-check')] })),
    }),
  );
  await screen.findByText('new-head-check');
});

describe('what the card says about the merge facts', () => {
  const agoMs = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const stored = (extra: Parameters<typeof buildSnapshotOf>[1]) => {
    snapshot.value = buildSnapshotOf({ authored: [pr] }, extra);
  };
  const freshness = () => document.querySelector('.pr-detail__freshness')?.textContent;

  it('gives the date they were read, and that cached ones are due', () => {
    stubDetailFetch(() => new Promise(() => {}));
    stored({ mergeStateAt: { [pr.id]: agoMs(20) }, mergeStateDue: [pr.id] });
    show();
    expect(freshness()).toBeUndefined();
  });

  it('gives no due mark to facts that were just read', () => {
    stubDetailFetch(() => new Promise(() => {}));
    stored({ mergeStateAt: { [pr.id]: agoMs(2) } });
    show();
    expect(freshness()).toBeUndefined();
  });

  it('says they were not verified for this commit when there is no date', () => {
    stubDetailFetch(() => new Promise(() => {}));
    stored({});
    show();
    expect(freshness()).toBeUndefined();
  });

  it('sends to GitHub for the connections and details it could not load', async () => {
    stubDetailFetch(() => detailNode({ latestReviews: { nodes: [], totalCount: 21 } }));
    show({ incomplete: ['conversations'] });
    const note = () => screen.getByRole('note');
    expect(note().textContent).toBe('Some details are only on GitHub · View on GitHub');
    await waitFor(() => expect(details.value[pr.id]?.loading).toBe(false));
    expect(within(note()).getByRole('link', { name: 'View on GitHub' })).toBeTruthy();
  });
});
