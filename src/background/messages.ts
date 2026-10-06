/** Routes the side panel's `BackgroundRequest`s. Answers (with nothing) once one is handled. */
import type { BackgroundRequest } from '../lib/model';
import { isRecord } from '../lib/storage/guards';
import { markSeen, updatePrLocal } from '../lib/storage/prLocal';
import { getItem } from '../lib/storage/storage';
import { clearSignedOut, poll } from './poller';

/** A message this worker understands, from this extension's own pages. */
function isRequest(message: unknown): message is BackgroundRequest {
  if (!isRecord(message)) return false;
  switch (message.type) {
    case 'poll':
      return message.force === undefined || typeof message.force === 'boolean';
    case 'markSeen':
      return Array.isArray(message.prIds) && message.prIds.every((id) => typeof id === 'string');
    case 'signedOut':
      return true;
    default:
      return false;
  }
}

async function route(request: BackgroundRequest): Promise<void> {
  switch (request.type) {
    case 'poll':
      await poll({ force: request.force === true });
      return;
    case 'markSeen': {
      const snapshot = await getItem('snapshot');
      await updatePrLocal((state) =>
        request.prIds.reduce((seen, id) => {
          const pr = snapshot?.pullRequests[id];
          return pr ? markSeen(seen, id, pr.updatedAt) : seen;
        }, state),
      );
      return;
    }
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
  route(message)
    .catch((error: unknown) => console.error('Prowl: message failed', error))
    .finally(sendResponse);
  return true;
}
