import { act, fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { KebabHorizontalIcon } from '../icons';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Menu, type MenuEntry, type MenuProps } from './Menu';

function setup(props: Partial<MenuProps> = {}) {
  const calls: string[] = [];
  const item = (id: string, label: string, extra = {}) => ({
    id,
    label,
    onSelect: () => calls.push(id),
    ...extra,
  });
  const items: MenuEntry[] = [
    item('open', 'Open in GitHub', { hint: 'o' }),
    item('copy', 'Copy branch name'),
    item('snooze', 'Snooze', { disabled: true }),
    'separator',
    item('mute', 'Mute notifications', { icon: <KebabHorizontalIcon /> }),
    item('close', 'Close pull request', { danger: true }),
  ];
  render(
    <div>
      <button type="button">Elsewhere</button>
      <Menu
        items={items}
        trigger={(p) => (
          <IconButton {...p} label="More actions">
            <KebabHorizontalIcon />
          </IconButton>
        )}
        {...props}
      />
    </div>,
  );
  const trigger = screen.getByRole('button', { name: 'More actions' });
  return { trigger, calls };
}

const menu = () => screen.queryByRole('menu');
const focused = () => document.activeElement?.textContent;
const key = (k: string, target: Element = document.activeElement as Element) =>
  fireEvent.keyDown(target, { key: k });

describe('Menu', () => {
  it('wires the trigger as a collapsed menu button', () => {
    const { trigger } = setup();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBeNull();
    expect(menu()).toBeNull();
  });

  it('opens on click with the first item focused', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const list = screen.getByRole('menu', { name: 'More actions' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(focused()).toBe('Open in GitHubo');
    fireEvent.click(trigger);
    expect(menu()).toBeNull();
  });

  it('opens from the keyboard on the first or last item', () => {
    const { trigger } = setup();
    key('ArrowDown', trigger);
    expect(focused()).toBe('Open in GitHubo');
    key('Escape');
    key('ArrowUp', trigger);
    expect(focused()).toBe('Close pull request');
    key('Escape');
    key('Enter', trigger);
    expect(menu()).toBeNull();
  });

  it('moves with arrows (wrapping, skipping disabled items), Home and End', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    key('ArrowDown');
    expect(focused()).toBe('Copy branch name');
    key('ArrowDown');
    expect(focused()).toBe('Mute notifications');
    key('ArrowDown');
    key('ArrowDown');
    expect(focused()).toBe('Open in GitHubo');
    key('ArrowUp');
    expect(focused()).toBe('Close pull request');
    key('Home');
    expect(focused()).toBe('Open in GitHubo');
    key('End');
    expect(focused()).toBe('Close pull request');
  });

  it('jumps to the next item starting with a typed letter', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    key('c');
    expect(focused()).toBe('Copy branch name');
    key('C');
    expect(focused()).toBe('Close pull request');
    key('z');
    expect(focused()).toBe('Close pull request');
    key('Shift');
    expect(menu()).not.toBeNull();
  });

  it('selects an item, closes and returns focus to the trigger', () => {
    const { trigger, calls } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy branch name' }));
    expect(calls).toEqual(['copy']);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('ignores disabled items', () => {
    const { trigger, calls } = setup();
    fireEvent.click(trigger);
    const snooze = screen.getByRole('menuitem', { name: 'Snooze' });
    expect(snooze.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(snooze);
    fireEvent.pointerMove(snooze);
    expect(calls).toEqual([]);
    expect(menu()).not.toBeNull();
    expect(focused()).toBe('Open in GitHubo');
  });

  it('follows the pointer', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.pointerMove(screen.getByRole('menuitem', { name: 'Mute notifications' }));
    expect(focused()).toBe('Mute notifications');
  });

  it('closes on Escape and Tab, returning focus to the trigger', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    key('Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    key('Tab');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on an outside pointer down or window blur, but not on inside events', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Snooze' }));
    fireEvent.scroll(screen.getByRole('menu'));
    expect(menu()).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(menu()).toBeNull();
    fireEvent.click(trigger);
    fireEvent(window, new Event('blur'));
    expect(menu()).toBeNull();
  });

  it('renders single-choice items as menuitemradio and uses an explicit label', () => {
    const onSelect = vi.fn();
    render(
      <Menu
        label="Sort by"
        items={[
          { id: 'updated', label: 'Recently updated', checked: true, onSelect },
          { id: 'created', label: 'Newest', checked: false, onSelect },
        ]}
        trigger={(p) => (
          <button type="button" {...p}>
            Sort
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    expect(screen.getByRole('menu', { name: 'Sort by' })).toBeTruthy();
    const [updated, created] = screen.getAllByRole('menuitemradio');
    expect(updated?.getAttribute('aria-checked')).toBe('true');
    expect(updated?.querySelector('svg')).not.toBeNull();
    expect(created?.getAttribute('aria-checked')).toBe('false');
    expect(created?.querySelector('svg')).toBeNull();
  });

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

  describe('with a bar fixed at the bottom of the panel', () => {
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
      expect(screen.getByRole('menu').style.top).toBe('427px');
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
