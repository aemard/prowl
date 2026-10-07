import { OPEN_PANEL_COMMAND } from '../lib/model';
import { subscribeSettings } from '../lib/storage/settings';
import { updateBadge, watchBadge } from './badge';
import { handleMessage } from './messages';
import { onNotificationButtonClicked, onNotificationClicked } from './notifier';
import { POLL_ALARM, poll, scheduleAlarm } from './poller';

/** Registers every service worker listener. Listeners must be added synchronously at startup. */
export function registerBackground(): void {
  const start = () => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    // The badge does not survive a browser restart: paint the stored snapshot before polling.
    void updateBadge();
    void poll();
  };
  chrome.runtime.onInstalled.addListener(start);
  chrome.runtime.onStartup.addListener(start);
  chrome.alarms.onAlarm.addListener(({ name }) => {
    if (name === POLL_ALARM) void poll();
  });
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.notifications.onClicked.addListener((id) => void onNotificationClicked(id));
  chrome.notifications.onButtonClicked.addListener(
    (id, index) => void onNotificationButtonClicked(id, index),
  );
  // `sidePanel.open` needs the shortcut's user gesture, so it is called before anything awaits.
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === OPEN_PANEL_COMMAND && tab?.windowId !== undefined) {
      void chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
  // A new interval applies to a running schedule; signed out or stopped, nothing is scheduled.
  subscribeSettings(({ pollIntervalMinutes }) => void scheduleAlarm(pollIntervalMinutes, true));
  watchBadge();
}
