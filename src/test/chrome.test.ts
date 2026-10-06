import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from './chrome';

describe('fake chrome', () => {
  it('stores values and emits change events', async () => {
    const listener = vi.fn();
    chrome.storage.onChanged.addListener(listener);
    await chrome.storage.local.set({ a: 1 });
    expect(await chrome.storage.local.get('a')).toEqual({ a: 1 });
    expect(listener).toHaveBeenCalledWith({ a: { newValue: 1 } }, 'local');
    await chrome.storage.local.remove('a');
    expect(await chrome.storage.local.get({ a: 2 })).toEqual({ a: 2 });
  });

  it('reports only values that changed, like Chrome', async () => {
    const listener = vi.fn();
    chrome.storage.local.onChanged.addListener(listener);
    await chrome.storage.local.set({ a: { x: 1, y: [1] } });
    await chrome.storage.local.set({ a: { y: [1], x: 1 } });
    await chrome.storage.local.set({ a: { x: 2, y: [1] }, b: 1 });
    await chrome.storage.local.set({ b: 1 });
    await chrome.storage.local.remove('missing');
    expect(listener.mock.calls).toEqual([
      [{ a: { newValue: { x: 1, y: [1] } } }],
      [{ a: { oldValue: { x: 1, y: [1] }, newValue: { x: 2, y: [1] } }, b: { newValue: 1 } }],
    ]);
    expect(Object.keys(listener.mock.calls[0]?.[0].a ?? {})).toEqual(['newValue']);
  });

  it('tracks alarms, notifications and badge', async () => {
    await chrome.alarms.create('poll', { periodInMinutes: 2 });
    expect((await chrome.alarms.get('poll'))?.periodInMinutes).toBe(2);
    await chrome.notifications.create('n1', {
      type: 'basic',
      title: 't',
      message: 'm',
      iconUrl: 'x.png',
    });
    expect(fakeChrome().__state.notifications.get('n1')?.options.title).toBe('t');
    await chrome.action.setBadgeText({ text: '3' });
    expect(await chrome.action.getBadgeText({})).toBe('3');
  });
});
