import { env } from '../lib/env';

/** True for URLs on the configured GitHub web origin (`env.webUrl`) and nothing else. */
export function isGitHubUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(env.webUrl).origin;
  } catch {
    return false;
  }
}

/** Opens a GitHub page in a new tab. The only way the panel opens a URL; refuses any other. */
export async function openGitHubUrl(url: string): Promise<void> {
  if (isGitHubUrl(url)) await chrome.tabs.create({ url });
}
