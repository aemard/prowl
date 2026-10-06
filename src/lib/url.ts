import { env } from './env';

/** True for URLs on the configured GitHub web origin (`env.webUrl`) and nothing else. */
export function isGitHubUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(env.webUrl).origin;
  } catch {
    return false;
  }
}
