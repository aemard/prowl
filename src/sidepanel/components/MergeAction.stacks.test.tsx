import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PullRequest } from '../../lib/model';
import { buildPullRequest, buildSnapshotOf } from '../../test/panel';
import { snapshot } from '../state/store';
import { MergeAction } from './MergeAction';
import { resetMergeTest, setupMergeTest, withDetail } from './MergeAction.test-support';

const ready = {
  mergeStateStatus: 'clean',
  reviewDecision: 'approved',
  autoMergeAllowed: true,
  viewerCanEnableAutoMerge: true,
} as const;
const member = (position: number, overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({
    number: 10 + position,
    title: `Part ${position}`,
    stack: { id: 'S7', number: 7, size: 3, position, base: 'main' },
    ...ready,
    ...overrides,
  });

/** The card of `shown` with `members` in the snapshot, its detail loaded. */
function card(shown: PullRequest, members: PullRequest[], placement?: 'merge' | 'auto') {
  snapshot.value = buildSnapshotOf({ authored: members });
  withDetail(shown);
  return render(<MergeAction pr={shown} placement={placement} />);
}

describe('a stacked pull request', () => {
  beforeEach(setupMergeTest);
  afterEach(() => {
    resetMergeTest();
    snapshot.value = undefined;
  });

  it('merges through its stack, up to itself, instead of on its own', () => {
    const members = [member(1), member(2), member(3)];
    card(members[1] as PullRequest, members);
    expect(screen.queryByRole('button', { name: /^Merge acme/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Merge stack #7 up to acme/widgets#12' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge 2 pull requests' });
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1acme/widgets#11 Part 1', '2acme/widgets#12 Part 2']);
    expect(dialog.textContent).toContain('The 1 above stay open');
  });

  it('says it merges from the stack while a pull request below it is not ready', () => {
    const members = [member(1, { isDraft: true }), member(2)];
    card(members[1] as PullRequest, members);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText(/In stack #7: it merges from the stack once/)).toBeTruthy();
  });

  it('offers no auto-merge or merge queue of its own', () => {
    const members = [member(1, { mergeStateStatus: 'blocked' })];
    card(members[0] as PullRequest, members, 'auto');
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
