/** Registers every service worker listener. Listeners must be added synchronously at startup. */
export function registerBackground(): void {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });
  chrome.runtime.onStartup.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });
}
