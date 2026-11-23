import { fireEvent, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import {
  choose,
  commitTitle,
  confirm,
  merged,
  opener,
  pr,
  resetMergeTest,
  setupMergeTest,
  show,
  stubGitHub,
} from './MergeAction.test-support';

beforeEach(setupMergeTest);
afterEach(resetMergeTest);

const commitTitles = {
  squash: 'Improve the widgets (#1)',
  merge: 'Merge pull request #1 from o/b',
};
const title = () => (commitTitle() as HTMLInputElement).value;

describe('the commit title', () => {
  it("starts on GitHub's title for each method", () => {
    show(
      { allowedMergeMethods: ['merge', 'squash'], defaultMergeMethod: 'squash' },
      { commitTitles },
    );
    fireEvent.click(opener());
    expect(title()).toBe(commitTitles.squash);
    choose('merge');
    expect(title()).toBe(commitTitles.merge);
  });

  it('keeps an edit to the method it was written for, and restores it on the way back', () => {
    show(
      { allowedMergeMethods: ['merge', 'squash'], defaultMergeMethod: 'squash' },
      { commitTitles },
    );
    fireEvent.click(opener());
    fireEvent.input(commitTitle(), { target: { value: 'Widgets, squashed' } });
    choose('merge');
    expect(title()).toBe(commitTitles.merge);
    choose('squash');
    expect(title()).toBe('Widgets, squashed');
  });

  it('sends no squash edit with a merge commit', async () => {
    const sent = stubGitHub(() => jsonResponse({ data: merged }));
    show(
      { allowedMergeMethods: ['merge', 'squash'], defaultMergeMethod: 'squash' },
      { commitTitles },
    );
    fireEvent.click(opener());
    fireEvent.input(commitTitle(), { target: { value: 'Widgets, squashed' } });
    choose('merge');
    fireEvent.click(confirm());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.variables).toEqual({ id: pr.id, method: 'MERGE', oid: pr.headSha });
  });
});
