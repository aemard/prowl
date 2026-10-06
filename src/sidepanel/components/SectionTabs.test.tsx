import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { SectionTabs } from './SectionTabs';

const TABS = [
  { id: 'authored', label: 'Created by me', count: 4 },
  { id: 'review_requested', label: 'Review requested', count: 0 },
  { id: 'custom-1', label: 'Stale', count: 0, failed: true },
];

function Harness({ start = 'authored' }: { start?: string }) {
  const [selected, setSelected] = useState(start);
  return <SectionTabs tabs={TABS} selectedId={selected} onSelect={setSelected} idPrefix="t" />;
}

describe('SectionTabs', () => {
  it('is a tab list with the selected tab as the only tab stop, and counts', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('tab', { name: 'Created by me 4' })).toBe(tabs[0]);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('t-panel');
  });

  it('shows a warning with text instead of a count when a section failed', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Stale Could not load' })).toBeTruthy();
  });

  it('selects on click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Review requested 0' }));
    expect(
      screen.getByRole('tab', { name: 'Review requested 0' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('moves with arrows, wrapping, Home and End, and focuses the new tab', () => {
    render(<Harness />);
    const press = (key: string) =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key });
    const selected = () => screen.getByRole('tab', { selected: true }).textContent;
    screen.getByRole('tab', { selected: true }).focus();

    press('ArrowRight');
    expect(selected()).toContain('Review requested');
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }));
    press('End');
    expect(selected()).toContain('Stale');
    press('ArrowRight');
    expect(selected()).toContain('Created by me');
    press('ArrowLeft');
    expect(selected()).toContain('Stale');
    press('Home');
    expect(selected()).toContain('Created by me');
    press('x');
    expect(selected()).toContain('Created by me');
  });

  it('lets the mouse wheel scroll a tab list that overflows sideways', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist');
    expect(fireEvent.wheel(list, { deltaY: 40 })).toBe(true);

    Object.defineProperty(list, 'scrollWidth', { value: 500 });
    Object.defineProperty(list, 'clientWidth', { value: 300 });
    expect(fireEvent.wheel(list, { deltaY: 40 })).toBe(false);
    expect(list.scrollLeft).toBe(40);
    expect(fireEvent.wheel(list, { deltaX: 10, deltaY: 40 })).toBe(true);
  });
});
