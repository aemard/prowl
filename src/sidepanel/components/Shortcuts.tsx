import { signal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { refreshRequested, requestRefresh, SHORTCUTS, shortcutFor } from '../state/shortcuts';
import { pollState, snapshot } from '../state/store';
import { Dialog } from './ui/Dialog';
import './Shortcuts.css';

export const shortcutsOpen = signal(false);

/** Focuses the expand button of the card `step` away from the focused one (first when none). */
function moveFocus(step: 1 | -1) {
  const toggles = [...document.querySelectorAll<HTMLElement>('.pr-list .pr-card__toggle')];
  if (toggles.length === 0) return;
  const card = document.activeElement?.closest('.pr-card');
  const index = toggles.findIndex((toggle) => toggle.closest('.pr-card') === card);
  const next = index === -1 ? 0 : Math.min(Math.max(index + step, 0), toggles.length - 1);
  toggles[next]?.focus();
  toggles[next]?.scrollIntoView({ block: 'nearest' });
}

/** Wires the list shortcuts to the document while the shell is shown. */
export function useShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'next') moveFocus(1);
      else if (shortcut === 'previous') moveFocus(-1);
      else if (shortcut === 'open')
        document.activeElement
          ?.closest('.pr-card')
          ?.querySelector<HTMLElement>('.pr-card__title')
          ?.click();
      else if (shortcut === 'refresh') requestRefresh();
      else if (shortcut === 'filter')
        document.querySelector<HTMLElement>('.list__filter input')?.focus();
      else shortcutsOpen.value = true;
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** The "?" dialog listing every shortcut. */
export function ShortcutsDialog() {
  if (!shortcutsOpen.value) return null;
  const close = () => {
    shortcutsOpen.value = false;
  };
  return (
    <Dialog open onClose={close} title="Keyboard shortcuts">
      <dl class="shortcuts">
        {SHORTCUTS.map(({ keys, action }) => (
          <div class="shortcuts__row" key={action}>
            <dt>
              {keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

/**
 * Reads out the result of a refresh the user asked for (button or `r`); background polls stay
 * silent so a screen reader is not interrupted every two minutes.
 */
export function RefreshAnnouncer() {
  const [message, setMessage] = useState('');
  const wasBusy = useRef(false);
  useSignalEffect(() => {
    const state = pollState.value;
    const busy = state?.inFlight === true;
    const requested = refreshRequested.value;
    // Done once no poll runs and one ran since the request: seen running, or started after it
    // (a fast poll can finish before the panel ever sees it running).
    const attempted = state?.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    if (requested !== null && !busy && (wasBusy.current || attempted >= requested - 1000)) {
      const error = state?.lastError;
      const count = Object.keys(snapshot.value?.pullRequests ?? {}).length;
      setMessage(
        error
          ? `Refresh failed: ${error.message}`
          : `Updated. ${count} pull request${count === 1 ? '' : 's'}.`,
      );
      refreshRequested.value = null;
    }
    wasBusy.current = busy;
  });
  return (
    <div class="sr-only" role="status" aria-live="polite">
      {message}
    </div>
  );
}
