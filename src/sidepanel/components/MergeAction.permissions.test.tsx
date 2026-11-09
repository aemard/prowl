import { fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { dialog, resetMergeTest, setupMergeTest, show } from './MergeAction.test-support';

beforeEach(setupMergeTest);
afterEach(resetMergeTest);

it.each([
  { viewerCanMergeAsAdmin: false },
  { viewerCanMergeAsAdmin: undefined },
  { autoMergeAllowed: true, viewerCanEnableAutoMerge: false },
  { autoMergeAllowed: true, viewerCanEnableAutoMerge: undefined },
])('hides blocked merges without a permitted action: %j', (permissions) => {
  const { container } = show({ mergeStateStatus: 'blocked', ...permissions });
  expect(container.textContent).toBe('');
});

it.each(['mergeable', 'mergeStateStatus', 'reviewDecision'] as const)(
  'offers no merge action when %s is unknown, even with bypass and auto-merge permissions',
  (field) => {
    const { container } = show({
      [field]: 'unknown',
      viewerCanMergeAsAdmin: true,
      autoMergeAllowed: true,
      viewerCanEnableAutoMerge: true,
    });
    expect(container.textContent).toBe('');
  },
);

it('offers only auto-merge to a blocked viewer who cannot bypass', () => {
  show({ mergeStateStatus: 'blocked', autoMergeAllowed: true });
  fireEvent.click(screen.getByRole('button', { name: 'Enable auto-merge acme/widgets#1' }));
  expect(within(dialog()).queryByRole('button', { name: 'Merge' })).toBeNull();
  expect(within(dialog()).getByRole('combobox', { name: 'Merge method' })).toBeTruthy();
  expect(within(dialog()).getByRole('textbox', { name: /Commit title/ })).toBeTruthy();
});

it.each([false, undefined])('hides disable auto-merge without permission (%s)', (permission) => {
  show({
    mergeStateStatus: 'blocked',
    autoMerge: { method: 'merge', enabledBy: 'octocat' },
    viewerCanDisableAutoMerge: permission,
  });
  expect(screen.queryByRole('button')).toBeNull();
});
