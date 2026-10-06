/**
 * Keyboard shortcuts of the list. `shortcutFor` is pure (what a key means where it was pressed);
 * `useShortcuts` in components/Shortcuts.tsx performs it.
 */
import { signal } from '@preact/signals';
import { sendToBackground } from './background';

export type Shortcut = 'next' | 'previous' | 'open' | 'refresh' | 'filter' | 'help';

export const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string }> = [
  { keys: ['j', '↓'], action: 'Next pull request' },
  { keys: ['k', '↑'], action: 'Previous pull request' },
  { keys: ['Enter', 'Space'], action: 'Expand or collapse the focused pull request' },
  { keys: ['o'], action: 'Open the focused pull request on GitHub' },
  { keys: ['r'], action: 'Refresh now' },
  { keys: ['/'], action: 'Filter pull requests' },
  { keys: ['?'], action: 'Show keyboard shortcuts' },
  { keys: ['Esc'], action: 'Close a dialog or menu, collapse a pull request' },
];

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}

const isEditable = (el: Element) =>
  el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

/** What `event` asks for, or null when the key is not a shortcut there (typing, a menu...). */
export function shortcutFor(event: KeyLike): Shortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target && (isEditable(target) || target.closest('[role="menu"], dialog'))) return null;
  const inList = target?.closest('.pr-list') != null;
  switch (event.key) {
    case 'j':
      return 'next';
    case 'k':
      return 'previous';
    case 'ArrowDown':
      return inList ? 'next' : null;
    case 'ArrowUp':
      return inList ? 'previous' : null;
    case 'o':
      return inList ? 'open' : null;
    case 'r':
      return 'refresh';
    case '/':
      return 'filter';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** When the user last asked for a refresh, until its outcome is announced; null otherwise. */
export const refreshRequested = signal<number | null>(null);

/** Refresh now (button or `r`): a forced poll whose outcome the announcer reads out. */
export function requestRefresh(): void {
  refreshRequested.value = Date.now();
  void sendToBackground({ type: 'poll', force: true });
}
