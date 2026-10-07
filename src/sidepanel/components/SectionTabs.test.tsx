import { fireEvent, render, screen, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { EyeIcon, FilterIcon, GitPullRequestIcon } from './icons';
import { type SectionTab, SectionTabs } from './SectionTabs';

const TABS: SectionTab[] = [
  {
    id: 'authored',
    label: 'Mine',
    fullLabel: 'Created by me',
    icon: <GitPullRequestIcon />,
    count: 4,
  },
  {
    id: 'review_requested',
    label: 'Review',
    fullLabel: 'Review requested',
    icon: <EyeIcon />,
    count: 0,
  },
  {
    id: 'custom-1',
    label: 'Stale',
    fullLabel: 'Stale',
    icon: <FilterIcon />,
    count: 0,
    failed: true,
  },
];

const custom = (n: number): SectionTab => ({
  id: `custom-${n}`,
  label: `Search ${n}`,
  fullLabel: `Search ${n}`,
  icon: <FilterIcon />,
  count: n,
});
/** Seven sections: four tabs, then "More" with the last three. */
const MANY = [...TABS.slice(0, 2), ...[3, 4, 5, 6, 7].map(custom)];

function Harness({ tabs = TABS, start = 'authored' }: { tabs?: SectionTab[]; start?: string }) {
  const [selected, setSelected] = useState(start);
  return <SectionTabs tabs={tabs} selectedId={selected} onSelect={setSelected} idPrefix="t" />;
}

const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });
const more = () => screen.getByRole('button', { name: /^More sections/ });

describe('SectionTabs', () => {
  it('is a tab list with the selected tab as the only tab stop, short names and counts', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    // The short name leads the accessible name; the full one is the tooltip.
    expect(screen.getByRole('tab', { name: 'Mine 4' })).toBe(tabs[0]);
    expect(tabs[0]?.title).toBe('Created by me');
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('t-panel');
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  });

  it('shows a warning with text instead of a count when a section failed', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Stale Could not load' })).toBeTruthy();
  });

  it('selects on click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Review 0' }));
    expect(screen.getByRole('tab', { name: 'Review 0' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('moves with arrows, wrapping, Home and End, and focuses the new tab', () => {
    render(<Harness />);
    const selected = () => screen.getByRole('tab', { selected: true }).textContent;
    screen.getByRole('tab', { selected: true }).focus();

    press('ArrowRight');
    expect(selected()).toContain('Review');
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }));
    press('End');
    expect(selected()).toContain('Stale');
    press('ArrowRight');
    expect(selected()).toContain('Mine');
    press('ArrowLeft');
    expect(selected()).toContain('Stale');
    press('Home');
    expect(selected()).toContain('Mine');
    press('x');
    expect(selected()).toContain('Mine');
  });

  it('shows five sections as five tabs', () => {
    render(<Harness tabs={MANY.slice(0, 5)} />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  });

  it('puts the sections past the fourth in a "More" menu, with their counts', () => {
    render(<Harness tabs={MANY} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Mine4',
      'Review0',
      'Search 33',
      'Search 44',
    ]);
    // Outside the tab list, which may only hold tabs.
    expect(within(screen.getByRole('tablist')).queryByRole('button')).toBeNull();
    expect(more().getAttribute('data-selected')).toBe('false');

    fireEvent.click(more());
    const menu = screen.getByRole('menu', { name: 'More sections' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['Search 55', 'Search 66', 'Search 77']);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
    ]);

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Search 6 6' }));
    expect(screen.queryByRole('menu')).toBeNull();
    // "More" is now the selected item, for the eye and for assistive tech.
    expect(more().getAttribute('data-selected')).toBe('true');
    expect(more().textContent).toBe('More sections, Search 6 selected');
    expect(screen.queryByRole('tab', { selected: true })).toBeNull();
    expect(document.activeElement).toBe(more());

    fireEvent.click(more());
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitemradio')
        .map((item) => item.getAttribute('aria-checked')),
    ).toEqual(['false', 'true', 'false']);
  });

  it('keeps one tab stop and the arrows among the tabs while the selection is under "More"', () => {
    render(<Harness tabs={MANY} start="custom-7" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    tabs[0]?.focus();
    press('ArrowLeft');
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Search 44');
    expect(more().getAttribute('data-selected')).toBe('false');
    press('ArrowRight');
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Mine4');
  });

  it('says in the menu when a section under "More" could not load', () => {
    render(<Harness tabs={[...MANY, { ...custom(8), failed: true }]} />);
    fireEvent.click(more());
    expect(screen.getByRole('menuitemradio', { name: 'Search 8 Could not load' })).toBeTruthy();
  });
});
