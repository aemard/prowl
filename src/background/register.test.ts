import { describe, expect, it, vi } from 'vitest';
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
});
