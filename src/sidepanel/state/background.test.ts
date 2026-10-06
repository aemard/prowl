import { describe, expect, it, vi } from 'vitest';
import { sendToBackground } from './background';

describe('sendToBackground', () => {
  it('sends the typed message to the service worker', async () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    await sendToBackground({ type: 'poll', force: true });
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
  });

  it('tolerates a missing receiver', async () => {
    vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    await expect(sendToBackground({ type: 'markSeen', prIds: ['PR_1'] })).resolves.toBeUndefined();
  });
});
