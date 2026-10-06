import { describe, expect, it } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import { refreshRequested, requestRefresh, shortcutFor } from './shortcuts';

function target(html: string, selector: string): Element {
  document.body.innerHTML = html;
  const el = document.querySelector(selector);
  if (!el) throw new Error(selector);
  return el;
}

describe('shortcutFor', () => {
  const card = () => target('<ul class="pr-list"><li><button id="t"></button></li></ul>', '#t');

  it('maps the list keys', () => {
    const inList = card();
    expect(shortcutFor({ key: 'j', target: document.body })).toBe('next');
    expect(shortcutFor({ key: 'k', target: document.body })).toBe('previous');
    expect(shortcutFor({ key: 'ArrowDown', target: inList })).toBe('next');
    expect(shortcutFor({ key: 'ArrowUp', target: inList })).toBe('previous');
    expect(shortcutFor({ key: 'o', target: inList })).toBe('open');
    expect(shortcutFor({ key: 'r', target: null })).toBe('refresh');
    expect(shortcutFor({ key: '/', target: document.body })).toBe('filter');
    expect(shortcutFor({ key: '?', target: document.body })).toBe('help');
    expect(shortcutFor({ key: 'x', target: document.body })).toBeNull();
  });

  it('leaves arrows and o alone outside the list', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'o']) {
      expect(shortcutFor({ key, target: document.body })).toBeNull();
    }
  });

  it('never fires while typing, in a menu or dialog, or with a modifier', () => {
    expect(shortcutFor({ key: 'j', target: target('<input id="i">', '#i') })).toBeNull();
    expect(
      shortcutFor({ key: 'r', target: target('<textarea id="i"></textarea>', '#i') }),
    ).toBeNull();
    expect(
      shortcutFor({
        key: 'j',
        target: target('<div role="menu"><button id="i"></button></div>', '#i'),
      }),
    ).toBeNull();
    expect(
      shortcutFor({ key: 'j', target: target('<dialog><p id="i"></p></dialog>', '#i') }),
    ).toBeNull();
    expect(shortcutFor({ key: 'r', ctrlKey: true, target: document.body })).toBeNull();
    expect(shortcutFor({ key: 'r', metaKey: true, target: document.body })).toBeNull();
    expect(shortcutFor({ key: 'r', altKey: true, target: document.body })).toBeNull();
  });
});

describe('requestRefresh', () => {
  it('forces a poll and remembers that the user asked', async () => {
    const sent: unknown[] = [];
    fakeChrome().runtime.sendMessage = async (message: unknown) => {
      sent.push(message);
      return undefined;
    };
    refreshRequested.value = null;
    requestRefresh();
    expect(refreshRequested.value).toBeTypeOf('number');
    await Promise.resolve();
    expect(sent).toEqual([{ type: 'poll', force: true }]);
  });
});
