import { OPEN_PANEL_COMMAND } from '../lib/model';
import { subscribeSettings } from '../lib/storage/settings';
import { updateBadge, watchBadge } from './badge';
import { checkFastLane, onChromeFocused } from './fastLane';
import { handleMessage } from './messages';
import { onNotificationButtonClicked, onNotificationClicked } from './notifier';
import { poll } from './poller';
import { INBOX_ALARM, POLL_ALARM, scheduleAlarms } from './pollState';
import { watchSettingsSync } from './sync';

/** Registers every service worker listener. Listeners must be added synchronously at startup. */
export function registerBackground(): void {
  const start = () => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    // The badge does not survive a browser restart: paint the stored snapshot before polling.
    void updateBadge();
    void poll({ reason: 'startup' });
  };
  chrome.runtime.onInstalled.addListener(start);
  chrome.runtime.onStartup.addListener(start);
  chrome.alarms.onAlarm.addListener(({ name, scheduledTime }) => {
    if (name === POLL_ALARM) void poll({ reason: 'schedule' });
    else if (name === INBOX_ALARM) void checkFastLane(scheduledTime);
  });
  chrome.runtime.onMessage.addListener(handleMessage);
  // Back from sleep or from another app: a list older than the interval refreshes at once.
  chrome.windows.onFocusChanged.addListener((id) => void onChromeFocused(id));
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
  subscribeSettings(({ pollIntervalMinutes }) => void scheduleAlarms(pollIntervalMinutes, true));
  watchBadge();
  watchSettingsSync();
}
