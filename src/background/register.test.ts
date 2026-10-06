import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../test/chrome';
import { registerBackground } from './register';

describe('registerBackground', () => {
  it('opens the side panel on action click after install and startup', () => {
    const spy = vi.spyOn(chrome.sidePanel, 'setPanelBehavior');
    registerBackground();
    fakeChrome().runtime.onInstalled.emit({ reason: 'install' } as chrome.runtime.InstalledDetails);
    fakeChrome().runtime.onStartup.emit();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });
});
