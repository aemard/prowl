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
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { showToast } from '../components/ui/Toast';
import { sendToBackground } from './background';
import { auth } from './store';

/** PR id -> name of the action running on it (`Approve`, ...). */
export const pendingActions = signal<Readonly<Record<string, string>>>({});

/** `acme/web#12`: what toasts and labels call a pull request. */
export const prRef = ({ repo, number }: PullRequest) => `${repo.nameWithOwner}#${number}`;

/** "Merge acme/web#12": the accessible name of a button that runs `label` on `pr`. */
export const forPr = (label: string, pr: PullRequest) => t('forPr', label, prRef(pr));

/**
 * Runs `run` with a client for the signed-in account and reports the outcome in a toast: what
 * `run` resolved to, else `done`, on success (and a forced poll), `<name> failed: <GitHub's
 * message>` otherwise, or that message to `onError` when the caller shows it itself (a dialog's
 * field). Resolves to whether it worked;
 * it never rejects, does nothing while another action of the PR runs, and drops the outcome (no
 * toast, no poll, `false`) when another account signed in meanwhile.
 * `name` is the button's wording ("Approve", "Request changes") and names the pending action.
 */
export async function runPrAction(
  pr: PullRequest,
  name: string,
  /** The toast's verb, unless `run` resolves to one (a string: how the action ended). */
  done: string,
  run: (client: GitHubClient) => Promise<unknown>,
  onError?: (message: string) => void,
): Promise<boolean> {
  const session = auth.value;
  const token = session?.token;
  if (!token || pendingActions.value[pr.id]) return false;
  pendingActions.value = { ...pendingActions.value, [pr.id]: name };
  try {
    const outcome = await run(createGitHubClient({ token, apiUrl: env.apiUrl }));
    if (auth.value !== session) return false;
    const verb = typeof outcome === 'string' && outcome ? outcome : done;
    showToast({ message: t('prDone', verb, prRef(pr)), tone: 'success' });
    void sendToBackground({ type: 'poll', reason: 'change' });
    return true;
  } catch (error) {
    if (auth.value !== session) return false;
    const reason = error instanceof GitHubError ? error.message : t('somethingWentWrong');
    if (onError) onError(reason);
    else showToast({ message: t('failed3', name, reason), tone: 'danger' });
    return false;
  } finally {
    const { [pr.id]: _finished, ...others } = pendingActions.value;
    pendingActions.value = others;
  }
}
