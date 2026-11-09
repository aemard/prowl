import { act, fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { Menu } from './Menu';
import { menu, setup } from './Menu.test-support';

describe('Menu placement and dialogs', () => {
  const rect = (x: number, y: number, w: number, h: number) =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }) as DOMRect;

  function layout(trigger: DOMRect) {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('role') === 'menu' ? rect(0, 0, 200, 120) : trigger;
    });
  }

  it('opens under the trigger, lined up with its end edge', () => {
    layout(rect(300, 40, 32, 32));
    const { trigger } = setup({ align: 'end' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu').style.top).toBe('76px');
    expect(screen.getByRole('menu').style.left).toBe('132px');
  });

  it('flips above the trigger near the bottom and stays inside the viewport', () => {
    layout(rect(300, 540, 32, 32));
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu').style.top).toBe('416px');
    expect(screen.getByRole('menu').style.left).toBe('152px');
  });

  it('stays below when there is no room above either', () => {
    layout(rect(10, 40, 32, 32));
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(150);
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu').style.top).toBe('76px');
    expect(screen.getByRole('menu').style.left).toBe('10px');
  });

  it('follows its trigger on scroll and resize, and closes once the trigger is out of view', () => {
    layout(rect(300, 40, 32, 32));
    const { trigger } = setup();
    fireEvent.click(trigger);
    layout(rect(300, 100, 32, 32));
    fireEvent.scroll(document);
    expect(screen.getByRole('menu').style.top).toBe('136px');
    layout(rect(10, 100, 32, 32));
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('menu').style.left).toBe('10px');
    layout(rect(10, -60, 32, 32));
    fireEvent.scroll(document);
    expect(menu()).toBeNull();
  });

  /** A 600 px viewport whose last 50 px are a bottom bar; `at` is where the trigger is. */
  function withBar(at: { trigger: DOMRect }) {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute('data-bottom-bar')) return rect(0, 550, 360, 50);
      return this.getAttribute('role') === 'menu' ? rect(0, 0, 200, 120) : at.trigger;
    });
  }

  describe('with a bar fixed at the bottom of the panel', () => {
    it('opens above a trigger whose menu would cover the bar, and closes behind it', () => {
      const at = { trigger: rect(10, 400, 32, 32) };
      withBar(at);
      render(<div data-bottom-bar="" />);
      const { trigger } = setup();
      fireEvent.click(trigger);
      // Below would end at 556 px: inside the viewport, but over the bar.
      expect(screen.getByRole('menu').style.top).toBe('276px');

      at.trigger = rect(10, 560, 32, 32);
      fireEvent.scroll(document);
      expect(menu()).toBeNull();
    });

    it('opens above its trigger when the trigger is in the bar, and stays open on scroll', () => {
      const at = { trigger: rect(296, 551, 64, 49) };
      withBar(at);
      render(
        <div data-bottom-bar="">
          <Menu
            align="end"
            items={[{ id: 'bots', label: 'Bots', onSelect: () => {} }]}
            trigger={(p) => (
              <button type="button" {...p}>
                More
              </button>
            )}
          />
        </div>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getByRole('menu').style.top).toBe('426px');
      fireEvent.scroll(document);
      expect(menu()).not.toBeNull();
    });
  });

  it('keeps an enclosing dialog open when Escape closes the menu', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Merge" onClose={onClose}>
        <Menu
          items={[{ id: 'squash', label: 'Squash and merge', onSelect: () => {} }]}
          trigger={(p) => (
            <button type="button" {...p}>
              Method
            </button>
          )}
        />
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Method' }));
    const list = screen.getByRole('menu');
    expect(screen.getByRole('dialog').contains(list)).toBe(true);
    expect(list.parentElement).toBe(screen.getByRole('button', { name: 'Method' }).parentElement);
    expect(list.getAttribute('popover')).toBe('manual');
    expect(list.matches(':popover-open')).toBe(true);
    const escKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.activeElement?.dispatchEvent(escKey);
    });
    expect(escKey.defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
