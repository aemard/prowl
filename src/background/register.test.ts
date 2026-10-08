import { describe, expect, it, vi } from 'vitest';
import { prNode, viewerNode } from '../../tests/fixtures/github';
import { mapPullRequest } from '../lib/github/mapPullRequest';
import { defaultSettings } from '../lib/storage/settings';
import { setItem, updateItem } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { POLL_ALARM, scheduleAlarm } from './poller';
import { registerBackground } from './register';

const alarm = () => fakeChrome().__state.alarms.get(POLL_ALARM);
/** Lets the listeners' storage and alarm calls settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('registerBackground', () => {
  it('opens the side panel on action click and polls after install and startup', async () => {
    const spy = vi.spyOn(chrome.sidePanel, 'setPanelBehavior');
    registerBackground();
    await scheduleAlarm(2);
    fakeChrome().runtime.onInstalled.emit({ reason: 'install' } as chrome.runtime.InstalledDetails);
    fakeChrome().runtime.onStartup.emit();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ openPanelOnActionClick: true });
    await settle();
    // Signed out, a poll unschedules the alarm.
    expect(alarm()).toBeUndefined();
  });

  it('polls when the poll alarm fires', async () => {
    registerBackground();
    await scheduleAlarm(2);
    fakeChrome().alarms.onAlarm.emit({ name: 'other' } as chrome.alarms.Alarm);
    await settle();
    expect(alarm()).toBeDefined();
    fakeChrome().alarms.onAlarm.emit({ name: POLL_ALARM } as chrome.alarms.Alarm);
    await settle();
    expect(alarm()).toBeUndefined();
  });

  it('routes messages', () => {
    registerBackground();
    expect(fakeChrome().runtime.onMessage.hasListeners()).toBe(true);
  });

  it('opens the pull request of a clicked notification', async () => {
    registerBackground();
    await chrome.storage.session.set({
      notified: { n1: 'https://github.com/acme/widgets/pull/1' },
    });
    fakeChrome().notifications.onClicked.emit('n1');
    await settle();
    expect(fakeChrome().__state.createdTabs).toEqual([
      { url: 'https://github.com/acme/widgets/pull/1' },
    ]);
  });

  it('paints the stored snapshot at startup and follows storage changes', async () => {
    const pr = mapPullRequest(prNode({ mergeStateStatus: 'CLEAN' }));
    const snapshot = {
      fetchedAt: '2026-10-06T11:59:00Z',
      viewer: viewerNode(),
      pullRequests: { [pr.id]: pr },
      sections: { authored: [pr.id] },
    };
    await chrome.storage.local.set({ snapshot });
    registerBackground();
    await settle();
    expect(fakeChrome().__state.badge.text).toBe('');

    fakeChrome().runtime.onStartup.emit();
    await vi.waitFor(() => expect(fakeChrome().__state.badge.text).toBe('1'));

    await chrome.storage.local.remove('snapshot');
    await vi.waitFor(() => expect(fakeChrome().__state.badge.text).toBe(''));
  });

  it('applies a new interval to a running schedule only', async () => {
    registerBackground();
    await setItem('settings', { ...defaultSettings(), pollIntervalMinutes: 5 });
    await settle();
    expect(alarm()).toBeUndefined();
    await scheduleAlarm(5);
    await updateItem('settings', (settings) => ({
      ...defaultSettings(),
      ...settings,
      pollIntervalMinutes: 10,
    }));
    await settle();
    expect(alarm()).toMatchObject({ periodInMinutes: 10 });
  });

  it('opens the side panel of the window the open-panel shortcut was pressed in', () => {
    registerBackground();
    const open = vi.spyOn(chrome.sidePanel, 'open');
    fakeChrome().commands.onCommand.emit('other', { windowId: 3 } as chrome.tabs.Tab);
    fakeChrome().commands.onCommand.emit('open-panel', undefined);
    expect(open).not.toHaveBeenCalled();
    fakeChrome().commands.onCommand.emit('open-panel', { windowId: 3 } as chrome.tabs.Tab);
    expect(open).toHaveBeenCalledWith({ windowId: 3 });
  });

  it('routes notification buttons to the notifier', async () => {
    registerBackground();
    await chrome.storage.session.set({
      notified: { 'PR_1:approved:r1': 'https://github.com/a/b/pull/1' },
    });
    fakeChrome().notifications.onButtonClicked.emit('PR_1:approved:r1', 0);
    await vi.waitFor(() =>
      expect(fakeChrome().__state.createdTabs).toEqual([{ url: 'https://github.com/a/b/pull/1' }]),
    );
  });
});
