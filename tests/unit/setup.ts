import { cleanup } from '@testing-library/preact';
import { afterEach, beforeEach } from 'vitest';
import { installFakeChrome } from '../../src/test/chrome';

// happy-dom does not implement the Popover API or its open-state selector yet.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.showPopover) {
  const shown = new WeakSet<HTMLElement>();
  const matches = HTMLElement.prototype.matches;
  HTMLElement.prototype.showPopover = function () {
    shown.add(this);
  };
  HTMLElement.prototype.hidePopover = function () {
    shown.delete(this);
  };
  Object.defineProperty(HTMLElement.prototype, 'matches', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, selector: string) {
      return selector === ':popover-open' ? shown.has(this) : matches.call(this, selector);
    },
  });
}

beforeEach(() => {
  installFakeChrome();
});

afterEach(() => {
  cleanup();
});
