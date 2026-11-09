import type { Viewer } from '../../src/lib/model';

/** `viewer { login avatarUrl name }`. */
export function viewerNode(overrides: Partial<Viewer> = {}): Viewer {
  return {
    login: 'octocat',
    avatarUrl: 'https://avatars.githubusercontent.com/u/583231?s=64&v=4',
    name: 'The Octocat',
    ...overrides,
  };
}
