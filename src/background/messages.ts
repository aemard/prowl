/** Routes the side panel's `BackgroundRequest`s. Answers (with nothing) once one is handled. */

import { activityKey } from '../lib/activity';
import type { BackgroundRequest } from '../lib/model';
import { isRecord } from '../lib/storage/guards';
import { markSeen, updatePrLocal } from '../lib/storage/prLocal';
import { withSignedIn } from '../lib/storage/session';
import { getItem } from '../lib/storage/storage';
import { clearSignedOut, poll, refreshMergeState, setMergePriority } from './poller';

/** A message this worker understands, from this extension's own pages. */
function isRequest(message: unknown): message is BackgroundRequest {
  if (!isRecord(message)) return false;
  switch (message.type) {
    case 'poll':
      return (
        (message.force === undefined || typeof message.force === 'boolean') &&
        (message.afterCurrent === undefined || typeof message.afterCurrent === 'boolean')
      );
    case 'refreshMergeState':
      return (
        typeof message.prId === 'string' &&
        message.prId.length > 0 &&
        typeof message.headSha === 'string' &&
        /^[a-f0-9]{40}$/i.test(message.headSha)
      );
    case 'mergePriority':
      return Array.isArray(message.prIds) && message.prIds.every((id) => typeof id === 'string');
    case 'markSeen':
      return (
        Array.isArray(message.prIds) &&
        message.prIds.every((id) => typeof id === 'string') &&
        (message.versions === undefined ||
          (isRecord(message.versions) &&
            Object.values(message.versions).every(
              (version) => typeof version === 'string' && version.length <= 16_384,
            )))
      );
    case 'signedOut':
    case 'refreshTeams':
      return true;
    default:
      return false;
  }
}

async function route(request: BackgroundRequest, document: string): Promise<void> {
  switch (request.type) {
    case 'poll':
      await poll({ force: request.force === true, afterCurrent: request.afterCurrent === true });
      return;
    case 'refreshMergeState':
      await refreshMergeState(request.prId, request.headSha);
      return;
    case 'mergePriority':
      setMergePriority(document, request.prIds);
      return;
    case 'markSeen': {
      const session = await getItem('auth');
      if (!session) return;
      await withSignedIn(session, async () => {
        const snapshot = await getItem('snapshot');
        if (snapshot?.viewer.login.toLowerCase() !== session.viewer.login.toLowerCase()) return;
        await updatePrLocal((state) =>
          request.prIds.reduce((seen, id) => {
            const pr = snapshot.pullRequests[id];
            if (!pr) return seen;
            const facts = activityKey(pr);
            if (request.versions && request.versions[id] !== facts) return seen;
            return markSeen(seen, id, pr.updatedAt, facts);
          }, state),
        );
      });
      return;
    }
    case 'refreshTeams':
      await poll({ force: true, refreshTeams: true });
      return;
    case 'signedOut':
      await clearSignedOut();
  }
}

/**
 * `runtime.onMessage` listener. Anything that is not a request from this extension is left to
 * other listeners. Requests are answered once handled (a forced poll: once it is done), so a
 * sender that awaits `sendMessage` knows the work is finished.
 */
export function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: () => void,
): boolean {
  if (sender.id !== chrome.runtime.id || !isRequest(message)) return false;
  route(message, sender.documentId ?? sender.url ?? 'panel')
    .catch((error: unknown) => console.error('Prowl: message failed', error))
    .finally(sendResponse);
  return true;
}
