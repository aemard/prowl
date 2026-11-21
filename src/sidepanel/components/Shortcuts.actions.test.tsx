import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPrLocal } from '../../lib/storage/prLocal';
import { defaultSettings } from '../../lib/storage/settings';
import { activeSectionId } from '../state/listContext';
import { settings } from '../state/store';
import { useShortcuts } from './Shortcuts';
import { toasts } from './ui/Toast';

function Harness() {
  useShortcuts(true);
  return (
    <ul class="pr-list">
      {['PR_1', 'PR_2'].map((id) => (
        <li class="pr-card" key={id}>
          <div class="pr-card__summary" data-pr-id={id}>
            <a class="pr-card__title" href={`#${id}`}>
              Title {id}
            </a>
            <button type="button" class="pr-card__toggle">
              Details {id}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

describe('card shortcuts', () => {
  afterEach(() => {
    toasts.value = [];
    settings.value = defaultSettings();
  });

  it('s snoozes the focused pull request for an hour and moves on', async () => {
    render(<Harness />);
    const last = screen.getByRole('button', { name: 'Details PR_2' });
    last.focus();
    fireEvent.keyDown(last, { key: 's' });
    await waitFor(async () => {
      const { snoozed } = await loadPrLocal();
      expect(Object.keys(snoozed)).toEqual(['PR_2']);
    });
    expect(toasts.value.at(-1)?.message).toBe('Snoozed for 1 hour: Title PR_2');
    expect(document.activeElement?.textContent).toBe('Details PR_1');
  });

  it('t shows the Your turn section when it is on', () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: 't' });
    expect(activeSectionId.value).toBe('your_turn');
  });
});
