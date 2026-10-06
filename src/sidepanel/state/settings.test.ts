import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from '../../lib/storage/settings';
import { fakeChrome } from '../../test/chrome';
import { toasts } from '../components/ui/Toast';
import { REFRESH_DELAY_MS, saveSettings } from './settings';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  toasts.value = [];
});

const polls = () =>
  vi.spyOn(fakeChrome().runtime, 'sendMessage').mockResolvedValue(undefined as never);

describe('saveSettings', () => {
  it('stores a patch or the result of an updater', async () => {
    await saveSettings({ theme: 'dark' });
    await saveSettings((current) => ({
      ...current,
      sort: current.theme === 'dark' ? 'repo' : 'created',
    }));
    expect(await loadSettings()).toMatchObject({ theme: 'dark', sort: 'repo' });
  });

  it('does not touch the worker unless the change decides what is fetched', async () => {
    const send = polls();
    await saveSettings({ theme: 'light' });
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('refreshes once, after the last of several changes', async () => {
    const send = polls();
    await saveSettings({ maxPerSection: 20 }, { refresh: true });
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS - 100);
    await saveSettings({ maxPerSection: 30 }, { refresh: true });
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS - 100);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'poll', force: true });
  });

  it('says so, and does not refresh, when storage refuses the write', async () => {
    const send = polls();
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('QUOTA_BYTES exceeded'));
    await saveSettings({ maxPerSection: 5 }, { refresh: true });
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS * 2);

    expect(toasts.value.map(({ message, tone }) => [message, tone])).toEqual([
      ['Could not save the setting. Try again.', 'danger'],
    ]);
    expect(send).not.toHaveBeenCalled();
  });
});
