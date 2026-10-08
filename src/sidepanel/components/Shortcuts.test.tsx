import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPollState } from '../../test/panel';
import { refreshRequested } from '../state/shortcuts';
import { pollState, snapshot } from '../state/store';
import { RepoGroup } from './RepoGroup';
import { RefreshAnnouncer, ShortcutsDialog, shortcutsOpen, useShortcuts } from './Shortcuts';

function Harness({ enabled = true }: { enabled?: boolean }) {
  useShortcuts(enabled);
  return (
    <>
      <div class="list__filter">
        <input type="search" aria-label="Filter" />
      </div>
      <ul class="pr-list">
        {[1, 2, 3].map((n) => (
          <li class="pr-card" key={n}>
            <a class="pr-card__title" href={`#pr${n}`}>
              PR {n}
            </a>
            <button type="button" class="pr-card__toggle">
              Details {n}
            </button>
          </li>
        ))}
      </ul>
      <ShortcutsDialog />
    </>
  );
}

function GroupedHarness() {
  useShortcuts(true);
  const cards = (names: string[]) =>
    names.map((name) => (
      <li class="pr-card" key={name}>
        <button type="button" class="pr-card__toggle">
          {name}
        </button>
      </li>
    ));
  return (
    <ul class="pr-list">
      <RepoGroup repo="acme/web" count={2} expanded onToggle={() => {}}>
        {cards(['Web 1', 'Web 2'])}
      </RepoGroup>
      <RepoGroup repo="acme/api" count={4} expanded={false} onToggle={() => {}}>
        {cards(['Not rendered'])}
      </RepoGroup>
      <RepoGroup repo="acme/docs" count={1} expanded onToggle={() => {}}>
        {cards(['Docs 1'])}
      </RepoGroup>
      <RepoGroup repo="acme/old" count={1} expanded={false} onToggle={() => {}}>
        {cards(['Not rendered either'])}
      </RepoGroup>
    </ul>
  );
}

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key });
const focusedText = () => document.activeElement?.textContent;

afterEach(() => {
  shortcutsOpen.value = false;
  refreshRequested.value = null;
  pollState.value = undefined;
  snapshot.value = undefined;
});

describe('useShortcuts', () => {
  it('moves focus between cards with j/k and arrows, clamped at the ends', () => {
    render(<Harness />);
    press('j');
    expect(focusedText()).toBe('Details 1');
    press('ArrowDown', document.activeElement as Element);
    expect(focusedText()).toBe('Details 2');
    press('j');
    press('j');
    expect(focusedText()).toBe('Details 3');
    press('k');
    press('ArrowUp', document.activeElement as Element);
    press('k');
    expect(focusedText()).toBe('Details 1');
  });

  it('moves through a grouped list: cards only, folded groups skipped, headers as starting points', () => {
    render(<GroupedHarness />);
    const header = (repo: string) => screen.getByRole('button', { name: new RegExp(`^${repo}`) });
    press('j');
    expect(focusedText()).toBe('Web 1');
    press('j');
    press('j');
    // The folded acme/api group has no cards to stop at.
    expect(focusedText()).toBe('Docs 1');
    press('k');
    expect(focusedText()).toBe('Web 2');

    // From a header: the card after it, or the one before it.
    header('acme/api').focus();
    press('j', document.activeElement as Element);
    expect(focusedText()).toBe('Docs 1');
    header('acme/api').focus();
    press('k');
    expect(focusedText()).toBe('Web 2');
    header('acme/docs').focus();
    press('ArrowDown', document.activeElement as Element);
    expect(focusedText()).toBe('Docs 1');

    // Nothing after the last header, nothing before the first: focus stays put.
    header('acme/old').focus();
    press('j');
    expect(document.activeElement).toBe(header('acme/old'));
    header('acme/web').focus();
    press('k');
    expect(document.activeElement).toBe(header('acme/web'));
  });

  it('opens the focused card, focuses the filter and shows the shortcuts', () => {
    render(<Harness />);
    let opened = '';
    for (const link of document.querySelectorAll('a')) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        opened = link.textContent ?? '';
      });
    }
    press('j');
    press('j');
    press('o', document.activeElement as Element);
    expect(opened).toBe('PR 2');
    press('/');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Filter');
    press('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getAllByRole('definition').length).toBeGreaterThan(5);
    // A dialog is open: list keys do nothing until it closes.
    press('j');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(shortcutsOpen.value).toBe(false);
  });

  it('refreshes on r, and does nothing when disabled', () => {
    const { unmount } = render(<Harness enabled={false} />);
    press('r');
    expect(refreshRequested.value).toBeNull();
    unmount();
    render(<Harness />);
    press('r');
    expect(refreshRequested.value).toBeTypeOf('number');
  });
});

describe('RefreshAnnouncer', () => {
  it('reads out the result of a refresh the user asked for, not background polls', async () => {
    render(<RefreshAnnouncer />);
    const region = screen.getByRole('status');
    await act(() => {
      pollState.value = buildPollState({ inFlight: true });
    });
    await act(() => {
      pollState.value = buildPollState({ inFlight: false });
    });
    expect(region.textContent).toBe('');

    await act(() => {
      refreshRequested.value = Date.now();
      pollState.value = buildPollState({ inFlight: true });
    });
    await act(() => {
      pollState.value = buildPollState({ inFlight: false });
    });
    expect(region.textContent).toBe('Updated. 0 pull requests.');
    expect(refreshRequested.value).toBeNull();

    // A poll so fast the panel never saw it running still counts once it started after the ask.
    await act(() => {
      refreshRequested.value = Date.now();
    });
    await act(() => {
      pollState.value = buildPollState({
        inFlight: false,
        lastAttemptAt: new Date(Date.now() + 10).toISOString(),
      });
    });
    expect(refreshRequested.value).toBeNull();

    await act(() => {
      refreshRequested.value = Date.now();
      pollState.value = buildPollState({ inFlight: true });
    });
    await act(() => {
      pollState.value = buildPollState({
        inFlight: false,
        lastError: { kind: 'network', message: 'Could not reach GitHub.' },
      });
    });
    expect(region.textContent).toBe('Refresh failed: Could not reach GitHub.');
  });
});
