import { describe, expect, it } from 'vitest';
import { fakeChrome } from '../test/chrome';
import { openGitHubUrl } from './openUrl';

describe('openGitHubUrl', () => {
  it('opens GitHub pages in a new tab and nothing else', async () => {
    await openGitHubUrl('https://github.com/octocat');
    await openGitHubUrl('https://evil.example/');
    expect(fakeChrome().__state.createdTabs).toEqual([{ url: 'https://github.com/octocat' }]);
  });
});
