/**
 * Running a change on GitHub from the panel (approve, request changes, comment; merge and
 * re-run later). One at a time per pull request: `pendingActions` is what disables the PR's other
 * buttons while one runs. The panel never writes `snapshot`: after GitHub confirmed, a forced poll
 * brings the new state in.
 */
import { signal } from '@preact/signals';
import { env } from '../../lib/env';
import { createGitHubClient, type GitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import type { PullRequest } from '../../lib/model';
import { showToast } from '../components/ui/Toast';
import { sendToBackground } from './background';
import { auth } from './store';

/** PR id -> name of the action running on it (`Approve`, ...). */
export const pendingActions = signal<Readonly<Record<string, string>>>({});

/** `acme/web#12`: what toasts and labels call a pull request. */
export const prRef = ({ repo, number }: PullRequest) => `${repo.nameWithOwner}#${number}`;

/**
 * Runs `run` with a client for the signed-in account and reports the outcome in a toast: `done`
 * on success (and a forced poll), `<name> failed: <GitHub's message>` otherwise. Resolves to
 * whether it worked; it never rejects, and does nothing while another action of the PR runs.
 * `name` is the button's wording ("Approve", "Request changes") and names the pending action.
 */
export async function runPrAction(
  pr: PullRequest,
  name: string,
  done: string,
  run: (client: GitHubClient) => Promise<void>,
): Promise<boolean> {
  const token = auth.value?.token;
  if (!token || pendingActions.value[pr.id]) return false;
  pendingActions.value = { ...pendingActions.value, [pr.id]: name };
  try {
    await run(createGitHubClient({ token, apiUrl: env.apiUrl }));
    showToast({ message: `${done} ${prRef(pr)}`, tone: 'success' });
    void sendToBackground({ type: 'poll', force: true });
    return true;
  } catch (error) {
    const reason = error instanceof GitHubError ? error.message : 'Something went wrong.';
    showToast({ message: `${name} failed: ${reason}`, tone: 'danger' });
    return false;
  } finally {
    const { [pr.id]: _finished, ...others } = pendingActions.value;
    pendingActions.value = others;
  }
}
