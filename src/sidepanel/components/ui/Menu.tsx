import type { ComponentChildren, TargetedKeyboardEvent, TargetedMouseEvent } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { CheckIcon } from '../icons';
import { cx } from './cx';
import './Menu.css';

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /** Decorative leading icon. */
  icon?: ComponentChildren;
  /** Muted trailing text, e.g. "Tomorrow 9:00". */
  hint?: string;
  disabled?: boolean;
  /** Destructive item (red text). */
  danger?: boolean;
  /** Makes the item a `menuitemradio` with this checked state (single-choice groups). */
  checked?: boolean;
}

export type MenuEntry = MenuItem | 'separator';

/** Props to spread on the trigger button (Button or IconButton forward them). */
export interface MenuTriggerProps {
  id: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls'?: string;
  onClick: (event: TargetedMouseEvent<HTMLElement>) => void;
  onKeyDown: (event: TargetedKeyboardEvent<HTMLElement>) => void;
}

export interface MenuProps {
  trigger: (props: MenuTriggerProps) => ComponentChildren;
  items: MenuEntry[];
  /** Which trigger edge the menu lines up with (default `start`). Use `end` near the right edge. */
  align?: 'start' | 'end';
  /** Accessible name of the menu; defaults to the trigger's name. */
  label?: string;
}

const GAP = 4;
const MARGIN = 8;

/**
 * Where the visible page ends for a menu: the top of a bar fixed at the bottom of the panel
 * (`data-bottom-bar`, the section bar) unless the trigger is in that bar, else the viewport's.
 */
function floorFor(trigger: HTMLElement): number {
  const bar = document.querySelector('[data-bottom-bar]');
  return bar && !bar.contains(trigger) ? bar.getBoundingClientRect().top : window.innerHeight;
}

/**
 * Places the fixed-position menu under (or above) the trigger, inside the viewport and clear of
 * a bottom bar. Returns false when the trigger has scrolled out of view (or behind that bar).
 */
function place(menu: HTMLElement, trigger: HTMLElement, align: 'start' | 'end'): boolean {
  const t = trigger.getBoundingClientRect();
  const floor = floorFor(trigger);
  if (t.bottom < 0 || t.top > floor) return false;
  const m = menu.getBoundingClientRect();
  // Floating bars inset their buttons: menus must clear the whole bar, including its padding.
  const bar = trigger.closest('[data-bottom-bar]');
  const anchorTop = bar ? Math.min(t.top, bar.getBoundingClientRect().top) : t.top;
  const fitsBelow = t.bottom + GAP + m.height <= floor - MARGIN;
  const top =
    fitsBelow || anchorTop - GAP - m.height < MARGIN ? t.bottom + GAP : anchorTop - GAP - m.height;
  const preferred = align === 'end' ? t.right - m.width : t.left;
  const left = Math.max(MARGIN, Math.min(preferred, window.innerWidth - MARGIN - m.width));
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
  return true;
}

function useMenuState(items: MenuEntry[]) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const enabled = items.flatMap((item, index) =>
    item !== 'separator' && !item.disabled ? [index] : [],
  );
  const show = (element: HTMLElement, which: 'first' | 'last') => {
    triggerRef.current = element;
    setActive((which === 'first' ? enabled[0] : enabled[enabled.length - 1]) ?? -1);
    setOpen(true);
  };
  const hide = (restoreFocus: boolean) => {
    setOpen(false);
    setActive(-1);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const select = (item: MenuItem) => {
    if (item.disabled) return;
    // Focus goes back first, so a dialog opened by onSelect restores focus to the trigger.
    hide(true);
    item.onSelect();
  };
  return { open, active, setActive, triggerRef, menuRef, enabled, show, hide, select };
}

function useMenuPlacement(state: ReturnType<typeof useMenuState>, align: 'start' | 'end') {
  const { open, active, menuRef, triggerRef, hide } = state;
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    if (triggerRef.current) place(menu, triggerRef.current, align);
    menu.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active, align]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      hide(false);
    };
    const follow = (event: Event) => {
      const menu = menuRef.current;
      if (!menu || menu.contains(event.target as Node | null) || !triggerRef.current) return;
      if (!place(menu, triggerRef.current, align)) hide(false);
    };
    const dismiss = () => hide(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      window.removeEventListener('blur', dismiss);
    };
  }, [open, align]);
}

function onMenuKeyDown(
  event: TargetedKeyboardEvent<HTMLDivElement>,
  items: MenuEntry[],
  { active, enabled, setActive, hide }: ReturnType<typeof useMenuState>,
) {
  const { key } = event;
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const delta = key === 'ArrowDown' ? 1 : -1;
    const next = (enabled.indexOf(active) + delta + enabled.length) % enabled.length;
    setActive(enabled[next] ?? -1);
  } else if (key === 'Home' || key === 'End') {
    setActive((key === 'Home' ? enabled[0] : enabled[enabled.length - 1]) ?? -1);
  } else if (key === 'Escape') {
    // Also keeps an enclosing dialog open.
    event.stopPropagation();
    hide(true);
  } else if (key === 'Tab') {
    hide(true);
    return;
  } else if (key.length === 1 && /\S/.test(key)) {
    const start = enabled.indexOf(active);
    const order = [...enabled.slice(start + 1), ...enabled.slice(0, start + 1)];
    const match = order.find((index) => {
      const entry = items[index];
      return entry !== 'separator' && entry?.label.toLowerCase().startsWith(key.toLowerCase());
    });
    if (match === undefined) return;
    setActive(match);
  } else {
    return;
  }
  event.preventDefault();
}

function menuTriggerProps(state: ReturnType<typeof useMenuState>, id: string): MenuTriggerProps {
  const { open, show, hide } = state;
  return {
    id: `${id}-trigger`,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? `${id}-menu` : undefined,
    onClick: (event) => (open ? hide(false) : show(event.currentTarget, 'first')),
    onKeyDown: (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      show(event.currentTarget, event.key === 'ArrowDown' ? 'first' : 'last');
    },
  };
}

function menuEntry(item: MenuEntry, index: number, state: ReturnType<typeof useMenuState>) {
  if (item === 'separator') {
    return <hr key={`separator-${index}`} class="ui-menu__separator" />;
  }
  const common = {
    key: item.id,
    type: 'button',
    tabIndex: -1,
    'data-index': index,
    'aria-disabled': item.disabled || undefined,
    class: cx('ui-menu__item', item.danger && 'ui-menu__item--danger'),
    onClick: () => state.select(item),
    onPointerMove: () => !item.disabled && index !== state.active && state.setActive(index),
  } as const;
  const content = (
    <>
      {item.checked !== undefined && (
        <span class="ui-menu__check">{item.checked && <CheckIcon />}</span>
      )}
      {item.icon && <span class="ui-menu__icon">{item.icon}</span>}
      <span class="ui-menu__label">{item.label}</span>
      {item.hint && <span class="ui-menu__hint">{item.hint}</span>}
    </>
  );
  return item.checked === undefined ? (
    <button role="menuitem" {...common}>
      {content}
    </button>
  ) : (
    <button role="menuitemradio" aria-checked={item.checked} {...common}>
      {content}
    </button>
  );
}

/**
 * Menu button (WAI-ARIA APG): Enter, Space or ArrowDown open on the first item, ArrowUp on the
 * last; arrows move (wrapping), Home/End jump, a letter jumps to the next matching item, Esc
 * closes and returns focus to the trigger, Tab closes, and so does a click outside. On scroll or
 * resize the menu follows its trigger, and closes once the trigger is out of view.
 */
export function Menu({ trigger, items, align = 'start', label }: MenuProps) {
  const state = useMenuState(items);
  const id = useId();
  useMenuPlacement(state, align);
  return (
    <>
      {trigger(menuTriggerProps(state, id))}
      {state.open && (
        <div
          ref={state.menuRef}
          id={`${id}-menu`}
          role="menu"
          class="ui-menu"
          aria-labelledby={label ? undefined : `${id}-trigger`}
          aria-label={label}
          tabIndex={-1}
          onKeyDown={(event) => onMenuKeyDown(event, items, state)}
        >
          {items.map((item, index) => menuEntry(item, index, state))}
        </div>
      )}
    </>
  );
}
