import { cleanup } from '@testing-library/preact';
import { afterEach, beforeEach, vi } from 'vitest';
import { installFakeChrome } from '../../src/test/chrome';

/**
 * Tests never reach GitHub: a request no test stubbed fails at once, instead of a real happy-dom
 * fetch that runs until teardown aborts it (`DOMException [AbortError]`). The mock GitHub server
 * of the E2E suite, on this machine, stays reachable.
 */
function guardFetch(real: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) return real(input, init);
    return Promise.reject(new TypeError(`No fetch stub for ${url} in this test.`));
  };
}

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
  // `unstubGlobals` puts happy-dom's back after each test; a test's own stub replaces this one.
  vi.stubGlobal('fetch', guardFetch(globalThis.fetch));
});

afterEach(() => {
  cleanup();
});
