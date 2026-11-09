import { expect, it } from 'vitest';
import { mapMergeState } from './mapPullRequest';

it.each([
  'viewerCanMergeAsAdmin',
  'viewerCanEnableAutoMerge',
  'viewerCanDisableAutoMerge',
] as const)('maps %s strictly and defaults missing permissions to false', (field) => {
  expect(mapMergeState({})[field]).toBe(false);
  expect(mapMergeState({ [field]: false })[field]).toBe(false);
  expect(mapMergeState({ [field]: true })[field]).toBe(true);
});
