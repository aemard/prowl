import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { buildPollState, buildPullRequest, buildSnapshotOf } from '../../test/panel';
import { pollState, snapshot } from '../state/store';
import { filterQuery, ListView } from './List';
import { withSections } from './List.test-support';

it('keeps proven coverage visible even when all loaded cards are hidden', () => {
  withSections(['authored'], { hideDrafts: true });
  const draft = buildPullRequest({ isDraft: true });
  snapshot.value = buildSnapshotOf(
    { authored: [draft] },
    {
      sectionCoverage: {
        authored: { hasMore: true, queries: [{ query: 'is:pr author:@me', cursor: '50' }] },
      },
    },
  );
  render(<ListView />);
  expect(screen.getByLabelText('List coverage').textContent).toContain('1 PR loaded. More results');
  expect(screen.getByRole('button', { name: 'Change limit' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View on GitHub' }).getAttribute('href')).toContain(
    'author%3A%40me',
  );
});

describe('a section still being searched', () => {
  const pending = () => buildSnapshotOf({ authored: [] }, { sectionsPending: ['authored'] });

  it('says so instead of calling the section empty', () => {
    withSections(['authored']);
    pollState.value = buildPollState({ inFlight: true });
    snapshot.value = pending();
    render(<ListView />);
    expect(screen.getByRole('status').textContent).toContain('Searching');
    expect(screen.queryByRole('heading', { name: 'No pull requests' })).toBeNull();
  });

  it('forgets the marker a failed or interrupted poll left in the snapshot', () => {
    withSections(['authored']);
    pollState.value = buildPollState({ inFlight: false });
    snapshot.value = pending();
    render(<ListView />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('heading', { name: 'No pull requests' })).toBeTruthy();
  });
});

it('links to the one search that has more results, not to all the team searches', () => {
  withSections(['authored']);
  snapshot.value = buildSnapshotOf(
    { authored: [buildPullRequest()] },
    {
      sectionCoverage: {
        authored: {
          hasMore: true,
          queries: [
            { query: 'team:first', cursor: null },
            { query: 'team:second', cursor: '50' },
          ],
        },
      },
    },
  );
  render(<ListView />);
  const href = screen.getByRole('link', { name: 'View on GitHub' }).getAttribute('href');
  expect(href).toContain('team%3Asecond');
  expect(href).not.toContain('team%3Afirst');
});

it('qualifies a local search with no matches when other GitHub results exist', () => {
  withSections(['authored']);
  snapshot.value = buildSnapshotOf(
    { authored: [buildPullRequest()] },
    {
      sectionCoverage: { authored: { hasMore: true, queries: [] } },
    },
  );
  filterQuery.value = 'no-such-pull-request';
  render(<ListView />);
  expect(screen.getByText(/This search only covers the loaded PRs/)).toBeTruthy();
});

it('says so for a section the running poll has not loaded yet, unless it failed', () => {
  withSections(['authored']);
  pollState.value = buildPollState({ inFlight: true });
  snapshot.value = buildSnapshotOf({});
  const { unmount } = render(<ListView />);
  expect(screen.getByRole('status').textContent).toContain('Searching');
  unmount();
  snapshot.value = buildSnapshotOf({}, { sectionErrors: { authored: 'GitHub refused it.' } });
  render(<ListView />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('links separately to every unfinished team search without joining queries', () => {
  withSections(['team_review_requested']);
  snapshot.value = buildSnapshotOf(
    { team_review_requested: [] },
    {
      sectionCoverage: {
        team_review_requested: {
          hasMore: true,
          queries: [
            { query: 'team:first', cursor: null },
            { query: 'team:second', cursor: '50' },
            { query: 'team:third', cursor: '25' },
          ],
        },
      },
    },
  );
  render(<ListView />);
  const links = screen.getAllByRole('link', { name: 'View on GitHub' });
  expect(links.map((link) => link.getAttribute('href')?.split('?q=')[1])).toEqual([
    'team%3Asecond',
    'team%3Athird',
  ]);
});
