import { render, screen } from '@testing-library/preact';
import { expect, it } from 'vitest';
import { buildSnapshotOf } from '../../test/panel';
import { snapshot } from '../state/store';
import { ListView } from './List';
import { cardTitles, pr, withSections } from './List.test-support';

it('shows stale drafts and bots despite legacy hiding settings, without a counts line', () => {
  withSections(['authored', 'review_requested'], {
    hideDrafts: true,
    hideBots: true,
    hideStaleAfterDays: 20,
  });
  const old = pr(1, {
    isDraft: true,
    author: { login: 'bot', avatarUrl: '', isBot: true },
    lastCommitAt: '2020-01-01T00:00:00.000Z',
  });
  snapshot.value = buildSnapshotOf({ authored: [old], review_requested: [] });
  render(<ListView />);
  expect(cardTitles()).toEqual(['PR number 1']);
  expect(screen.getByRole('tab', { name: /^Mine/ }).textContent).toBe('Mine1');
  expect(screen.queryByRole('note')).toBeNull();
  expect(screen.queryByRole('button', { name: /hidden/i })).toBeNull();
});
