import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubError } from '../../lib/github/errors';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { toasts } from '../components/ui/Toast';
import { pendingActions, prRef, runPrAction } from './prActions';
import { auth } from './store';

const pr = buildPullRequest({ number: 7 });

beforeEach(() => {
  auth.value = buildAuth();
});

afterEach(() => {
  auth.value = undefined;
  pendingActions.value = {};
  toasts.value = [];
  vi.restoreAllMocks();
});

describe('runPrAction', () => {
  it('names a pull request owner/name#number', () => {
    expect(prRef(pr)).toBe('acme/widgets#7');
  });

  it('runs with a client of the signed-in account, then reports and polls', async () => {
    const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
    const run = vi.fn(async () => {
      expect(pendingActions.value).toEqual({ [pr.id]: 'Merge' });
    });
    expect(await runPrAction(pr, 'Merge', 'Merged', run)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(toasts.value.map(({ message, tone }) => [tone, message])).toEqual([
      ['success', 'Merged acme/widgets#7'],
    ]);
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
    expect(pendingActions.value).toEqual({});
  });

  it('keeps GitHub’s message and hides any other failure behind a generic one', async () => {
    const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
    expect(
      await runPrAction(pr, 'Merge', 'Merged', async () => {
        throw new GitHubError('validation', 'Base branch was modified');
      }),
    ).toBe(false);
    expect(
      await runPrAction(pr, 'Merge', 'Merged', async () => {
        throw new Error('ghp_test leaked');
      }),
    ).toBe(false);
    expect(toasts.value.map(({ message, tone }) => [tone, message])).toEqual([
      ['danger', 'Merge failed: Base branch was modified'],
      ['danger', 'Merge failed: Something went wrong.'],
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(pendingActions.value).toEqual({});
  });

  it('runs one action per pull request at a time, but other pull requests in parallel', async () => {
    let finish = () => {};
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = runPrAction(pr, 'Approve', 'Approved', slow);
    const again = vi.fn(async () => {});
    expect(await runPrAction(pr, 'Comment', 'Commented on', again)).toBe(false);
    expect(again).not.toHaveBeenCalled();

    const other = buildPullRequest({ number: 8 });
    expect(await runPrAction(other, 'Approve', 'Approved', again)).toBe(true);
    expect(pendingActions.value).toEqual({ [pr.id]: 'Approve' });

    finish();
    expect(await first).toBe(true);
    expect(pendingActions.value).toEqual({});
  });

  it('does nothing without a signed-in account', async () => {
    auth.value = undefined;
    const run = vi.fn(async () => {});
    expect(await runPrAction(pr, 'Approve', 'Approved', run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(toasts.value).toEqual([]);
  });
});
