import type { BackgroundRequest } from '../../lib/model';

/**
 * Sends a typed message to the service worker. Resolves either way: with no receiver (worker
 * not listening yet, extension reloading) there is nothing the panel could do about it, and the
 * worker's next poll or storage write brings the panel up to date anyway.
 */
export async function sendToBackground(message: BackgroundRequest): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // No receiver: see above.
  }
}
