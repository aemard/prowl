import { signal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { countMessage, t } from '../../lib/i18n';
import { snooze, unsnooze, updatePrLocal } from '../../lib/storage/prLocal';
import { selectSection } from '../state/listContext';
import { refreshRequested, requestRefresh, SHORTCUTS, shortcutFor } from '../state/shortcuts';
import { pollState, settings, snapshot } from '../state/store';
import { Dialog } from './ui/Dialog';
import { showToast } from './ui/Toast';
import './Shortcuts.css';

export const shortcutsOpen = signal(false);

/**
 * Focuses the expand button of the card `step` away from the focused one (the first when none is
 * focused). From a repository header, the card just after or before it: cards of a folded group
 * are not in the DOM, so they are skipped.
 */
function moveFocus(step: 1 | -1) {
  const toggles = [...document.querySelectorAll<HTMLElement>('.pr-list .pr-card__toggle')];
  if (toggles.length === 0) return;
  const from = document.activeElement;
  const card = from?.closest('.pr-card');
  let next = 0;
  if (card) {
    const index = toggles.findIndex((toggle) => toggle.closest('.pr-card') === card);
    next = Math.min(Math.max(index + step, 0), toggles.length - 1);
  } else if (from?.closest('.repo-group__heading')) {
    const after = toggles.findIndex(
      (toggle) => from.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    next = step === 1 ? after : (after === -1 ? toggles.length : after) - 1;
  }
  toggles[next]?.focus();
  toggles[next]?.scrollIntoView({ block: 'nearest' });
}

/** `s`: snoozes the focused card's PR for an hour and says so (the card leaves the list). */
function snoozeFocused() {
  const card = document.activeElement?.closest('.pr-card');
  const id = card?.querySelector<HTMLElement>('[data-pr-id]')?.dataset.prId;
  const title = card?.querySelector('.pr-card__title')?.textContent ?? '';
  if (!id) return;
  // Keep focus in the list: on the next card, or the previous one for the last card.
  moveFocus(1);
  if (document.activeElement?.closest('.pr-card') === card) moveFocus(-1);
  void updatePrLocal((state) => snooze(state, id, Date.now() + HOUR));
  // One key did it: one click takes it back.
  showToast({
    message: t('snoozedForAnHour', title),
    tone: 'success',
    action: { label: t('undo'), onClick: () => void updatePrLocal((s) => unsnooze(s, id)) },
  });
}

/** `t`: selects the "Your turn" section when it is on. */
function showYourTurn() {
  const section = settings.value.sections.find((s) => s.kind === 'your_turn' && s.enabled);
  if (section) void selectSection(section.id);
}

const HOUR = 60 * 60 * 1000;

/** Wires the list shortcuts to the document while the shell is shown. */
export function useShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const shortcut = shortcutFor(event, settings.value.singleKeyShortcuts);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'next') moveFocus(1);
      else if (shortcut === 'previous') moveFocus(-1);
      else if (shortcut === 'open')
        document.activeElement
          ?.closest('.pr-card')
          ?.querySelector<HTMLElement>('.pr-card__title')
          ?.click();
      else if (shortcut === 'snooze') snoozeFocused();
      else if (shortcut === 'yourTurn') showYourTurn();
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
    <Dialog open onClose={close} title={t('keyboardShortcuts')}>
      {!settings.value.singleKeyShortcuts && <p>{t('singleKeyShortcutsOff')}</p>}
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
    const busy = state?.inFlight === true && state.mergePending === undefined;
    const requested = refreshRequested.value;
    // The list is ready before merge enrichment finishes. A poll shared with a second click
    // also counts once it succeeds after that request.
    const attempted = state?.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    const succeeded = state?.lastSuccessAt ? Date.parse(state.lastSuccessAt) : 0;
    if (
      requested !== null &&
      !busy &&
      (wasBusy.current || attempted >= requested - 1000 || succeeded >= requested)
    ) {
      const error = state?.lastError;
      const count = Object.keys(snapshot.value?.pullRequests ?? {}).length;
      setMessage(
        error
          ? t('refreshFailed', error.message)
          : countMessage(count, 'refreshedOne', 'refreshedOther'),
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
