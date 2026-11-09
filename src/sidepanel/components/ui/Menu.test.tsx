import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';
import { focused, key, menu, setup } from './Menu.test-support';

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

  it('shows a popover inside the trigger container', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const list = screen.getByRole('menu');
    expect(list.parentElement).toBe(trigger.parentElement);
    expect(list.getAttribute('popover')).toBe('manual');
    expect(list.matches(':popover-open')).toBe(true);
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

  it('renders independent toggles as menuitemcheckbox, not as a radio group', () => {
    render(
      <Menu
        label="Options"
        items={[
          {
            id: 'pin',
            label: 'Pin',
            checked: true,
            checkRole: 'menuitemcheckbox',
            onSelect: vi.fn(),
          },
        ]}
        trigger={(p) => (
          <button type="button" {...p}>
            Options
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Pin' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });
});
