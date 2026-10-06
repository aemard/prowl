import { subscribeSettings } from '../lib/storage/settings';
import { handleMessage } from './messages';
import { onNotificationClicked } from './notifier';
import { POLL_ALARM, poll, scheduleAlarm } from './poller';

/** Registers every service worker listener. Listeners must be added synchronously at startup. */
export function registerBackground(): void {
  const start = () => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    void poll();
  };
  chrome.runtime.onInstalled.addListener(start);
  chrome.runtime.onStartup.addListener(start);
  chrome.alarms.onAlarm.addListener(({ name }) => {
    if (name === POLL_ALARM) void poll();
  });
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.notifications.onClicked.addListener((id) => void onNotificationClicked(id));
  // A new interval applies to a running schedule; signed out or stopped, nothing is scheduled.
  subscribeSettings(({ pollIntervalMinutes }) => void scheduleAlarm(pollIntervalMinutes, true));
}
