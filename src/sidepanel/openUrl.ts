import { isGitHubUrl } from '../lib/url';

/** Opens a GitHub page in a new tab. The only way the panel opens a URL; refuses any other. */
export async function openGitHubUrl(url: string): Promise<void> {
  if (isGitHubUrl(url)) await chrome.tabs.create({ url });
}
