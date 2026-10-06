import { describe, expect, it } from 'vitest';
import { fakeChrome } from '../test/chrome';
import { isGitHubUrl, openGitHubUrl } from './openUrl';

describe('isGitHubUrl', () => {
  it.each([
    ['https://github.com/octocat', true],
    ['https://github.com/owner/repo/pull/7?x=1#files', true],
    ['https://github.com.evil.example/octocat', false],
    ['https://evil.example/https://github.com/octocat', false],
    ['http://github.com/octocat', false],
    ['javascript:alert(1)', false],
    ['chrome://settings', false],
    ['/octocat', false],
    ['', false],
  ])('%j -> %s', (url, expected) => {
    expect(isGitHubUrl(url)).toBe(expected);
  });
});

describe('openGitHubUrl', () => {
  it('opens GitHub pages in a new tab and nothing else', async () => {
    await openGitHubUrl('https://github.com/octocat');
    await openGitHubUrl('https://evil.example/');
    expect(fakeChrome().__state.createdTabs).toEqual([{ url: 'https://github.com/octocat' }]);
  });
});
