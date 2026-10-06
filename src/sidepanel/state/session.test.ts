import { afterEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '../../lib/storage/storage';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { toasts } from '../components/ui/Toast';
import { completeSignIn, signOut } from './session';

afterEach(() => {
  location.hash = '';
  toasts.value = [];
});

describe('completeSignIn', () => {
  it('stores the auth, asks for the first poll and shows the list', async () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    location.hash = '#/onboarding';

    await completeSignIn(buildAuth('octocat'));

    expect((await chrome.storage.local.get('auth')).auth).toEqual(buildAuth('octocat'));
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
    expect(location.hash).toBe('#/');
  });

  it('keeps a warning on screen as a toast', async () => {
    await completeSignIn(buildAuth('octocat'), 'This token has no repo scope.');
    expect(toasts.value).toMatchObject([
      { message: 'Signed in as octocat. This token has no repo scope.' },
    ]);
  });

  it('does not navigate or poll when storing fails', async () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('quota'));
    location.hash = '#/onboarding';

    await expect(completeSignIn(buildAuth())).rejects.toThrow('quota');
    expect(send).not.toHaveBeenCalled();
    expect(location.hash).toBe('#/onboarding');
  });
});

describe('signOut', () => {
  it('removes the account and what was fetched with it, keeps settings, and tells the worker', async () => {
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    await chrome.storage.local.set({
      auth: buildAuth(),
      snapshot: buildSnapshot(),
      pollState: buildPollState(),
      settings: { version: 1 },
      prLocal: { snoozed: {}, muted: {}, seen: {} },
    });

    await signOut();

    expect(
      Object.keys(await getItems(['auth', 'snapshot', 'pollState', 'settings', 'prLocal'])),
    ).toEqual(['settings', 'prLocal']);
    expect(send).toHaveBeenCalledWith({ type: 'signedOut' });
  });
});
