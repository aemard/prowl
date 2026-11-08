import { fireEvent, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MergeMethod, PullRequest } from '../../lib/model';
import { buildDetail } from '../../test/panel';
import { detailKey, details } from '../state/prDetail';
import {
  method,
  opener,
  pr,
  resetMergeTest,
  setupMergeTest,
  show,
} from './MergeAction.test-support';

beforeEach(setupMergeTest);
afterEach(() => {
  resetMergeTest();
  details.value = {};
});

describe('the methods the branch rules allow', () => {
  const all: MergeMethod[] = ['merge', 'squash', 'rebase'];
  const offered = () =>
    within(method())
      .getAllByRole('option')
      .map(({ textContent }) => textContent);
  /** What the expanded card read, as `loadDetail` stores it for `readFor`. */
  const read = (readFor: Partial<PullRequest>) => {
    details.value = {
      [pr.id]: {
        key: detailKey({ ...pr, allowedMergeMethods: all, ...readFor }),
        loading: false,
        detail: buildDetail({ allowedMergeMethods: ['squash'] }),
      },
    };
  };

  it('narrow the repository methods once read for this pull request', () => {
    read({});
    show({ allowedMergeMethods: all });
    fireEvent.click(opener());
    expect(offered()).toEqual(['Squash and merge']);
  });

  it('are not taken from a read made for another head', () => {
    read({ headSha: 'c'.repeat(40) });
    show({ allowedMergeMethods: all });
    fireEvent.click(opener());
    expect(offered()).toEqual(['Create a merge commit', 'Squash and merge', 'Rebase and merge']);
  });
});
