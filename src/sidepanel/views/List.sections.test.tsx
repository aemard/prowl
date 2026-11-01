import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, expect, it } from 'vitest';
import { buildSnapshotOf } from '../../test/panel';
import { settings, snapshot } from '../state/store';
import { activeSectionId, ListView } from './List';
import { cardTitles, pr, withSections } from './List.test-support';

beforeEach(() => {
  withSections(['authored', 'review_requested', 'custom-1']);
  settings.value = {
    ...settings.value,
    sections: [
      ...settings.value.sections,
      { id: 'custom-1', kind: 'custom', label: 'Stale', enabled: true, query: 'is:pr stale' },
    ],
  };
  snapshot.value = buildSnapshotOf(
    {
      authored: [pr(1), pr(2)],
      review_requested: [pr(3, { title: 'Please review me' })],
    },
    { sectionErrors: { 'custom-1': 'Search failed: validation' } },
  );
});

it('several sections shows the section bar with short names, icons and counts, and switches panels', () => {
  render(<ListView />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Mine2', 'Review1', 'StaleCould not load']);
  expect(tabs.map((tab) => tab.title)).toEqual(['Created by me', 'Review requested', 'Stale']);
  expect(tabs.map((tab) => tab.querySelectorAll('svg[aria-hidden="true"]').length)).toEqual([
    1, 1, 2,
  ]);
  expect(screen.getByRole('tabpanel', { name: 'Created by me' }).id).toBe(
    screen.getByRole('tab', { selected: true }).getAttribute('aria-controls'),
  );
  expect(cardTitles()).toEqual(['PR number 1', 'PR number 2']);
  // The filter, then the tabs, then the panel they control.
  const [filter, tablist, panel] = ['searchbox', 'tablist', 'tabpanel'].map((role) =>
    screen.getByRole(role),
  ) as HTMLElement[];
  const follows = (a?: Node, b?: Node) =>
    Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(follows(filter, tablist) && follows(tablist, panel)).toBe(true);

  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }));
  expect(cardTitles()).toEqual(['Please review me']);
  expect(screen.getByRole('tabpanel', { name: 'Review requested' })).toBeTruthy();
});

it('several sections counts only what matches the filter', () => {
  render(<ListView />);
  fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'review me' } });
  expect(
    screen
      .getAllByRole('tab')
      .map((tab) => tab.textContent)
      .slice(0, 2),
  ).toEqual(['Mine0', 'Review1']);
  expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();
});

it('several sections shows what went wrong in a section that failed instead of an empty state', () => {
  render(<ListView />);
  fireEvent.click(screen.getByRole('tab', { name: /Stale/ }));
  expect(screen.getByText(/Could not load “Stale”: Search failed: validation/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'No pull requests' })).toBeNull();
});

it('several sections shows Team reviews as "Teams", with the teams that loaded under its notice', () => {
  withSections(['authored', 'team_review_requested']);
  snapshot.value = buildSnapshotOf(
    { authored: [pr(1)], team_review_requested: [pr(4, { title: 'Team PR' })] },
    { sectionErrors: { team_review_requested: 'GitHub refused the search for acme/gone.' } },
  );
  render(<ListView />);
  const tab = screen.getByRole('tab', { name: /^Teams/ });
  expect(tab.title).toBe('Team reviews');
  fireEvent.click(tab);
  expect(
    screen.getByText('Could not load “Team reviews”: GitHub refused the search for acme/gone.'),
  ).toBeTruthy();
  expect(cardTitles()).toEqual(['Team PR']);
});

it('several sections falls back to the first section when the selected one is turned off', () => {
  activeSectionId.value = 'mentioned';
  render(<ListView />);
  expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Mine');
});

it('several sections puts the sections past the fourth under "More" and shows the one picked there', () => {
  const extra = ['Bots', 'Docs', 'Infra'].map((label, n) => ({
    id: `custom-${n + 2}`,
    kind: 'custom' as const,
    label,
    enabled: true,
    query: `is:pr ${label}`,
  }));
  withSections(['authored', 'review_requested', 'mentioned', 'assigned']);
  settings.value = { ...settings.value, sections: [...settings.value.sections, ...extra] };
  snapshot.value = buildSnapshotOf({ authored: [pr(1)], 'custom-3': [pr(9, { title: 'Docs' })] });
  render(<ListView />);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Mine1',
    'Review0',
    'Mentions0',
    'Assigned0',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'More sections' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Docs 1' }));
  expect(screen.getByRole('button', { name: 'More sections, Docs selected' })).toBeTruthy();
  expect(cardTitles()).toEqual(['Docs']);
  expect(screen.queryByRole('tab', { selected: true })).toBeNull();
  expect(screen.getByRole('tabpanel', { name: 'Docs' })).toBeTruthy();
});
