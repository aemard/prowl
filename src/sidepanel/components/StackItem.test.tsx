import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PullRequest } from '../../lib/model';
import { buildAuth, buildPullRequest, buildSnapshotOf } from '../../test/panel';
import { openStacks } from '../state/stacks';
import { auth } from '../state/store';
import { StackItem } from './StackItem';

const ready = { mergeStateStatus: 'clean', reviewDecision: 'approved' } as const;
const member = (position: number, size: number, overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({
    number: 10 + position,
    title: `Part ${position}`,
    stack: { id: 'S7', number: 7, size, position, base: 'main' },
    ...ready,
    ...overrides,
  });

function show(members: PullRequest[], shown = members) {
  const snapshot = buildSnapshotOf({ authored: members });
  return render(
    <ul>
      <StackItem
        members={members}
        shown={shown}
        snapshot={snapshot}
        card={(pr) => <li key={pr.id}>{pr.title}</li>}
      />
    </ul>,
  );
}

describe('StackItem', () => {
  beforeEach(() => {
    auth.value = buildAuth();
  });
  afterEach(() => {
    openStacks.value = [];
    auth.value = undefined;
  });

  it('renders nothing for pull requests outside a stack', () => {
    const { container } = render(
      <StackItem
        members={[buildPullRequest()]}
        shown={[]}
        snapshot={buildSnapshotOf({})}
        card={() => <li />}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('names a one-PR stack by its title alone, and folds and unfolds its members', () => {
    show([member(1, 1)]);
    expect(document.querySelector('.stack-item__title')?.textContent).toBe('Part 1');
    const toggle = screen.getByRole('button', { name: 'Show the pull requests of stack #7' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const hide = screen.getByRole('button', { name: 'Hide the pull requests of stack #7' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(String(hide.getAttribute('aria-controls')))?.tagName).toBe('OL');
    expect(screen.getByText('main · base of the stack')).toBeTruthy();
    fireEvent.click(hide);
    expect(screen.queryByText('Part 1', { selector: 'li' })).toBeNull();
  });

  it('offers no merge to a viewer who cannot merge, or when the bottom is not ready', () => {
    show([member(1, 2), member(2, 2, { viewerCanMerge: false })]);
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    cleanup();
    show([member(1, 2, { isDraft: true }), member(2, 2)]);
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
  });

  it('opens the merge of the ready run, named by the stack', () => {
    show([member(1, 3), member(2, 3), member(3, 3, { isDraft: true })]);
    const merge = screen.getByRole('button', { name: 'Merge 2 of 3' });
    expect(merge.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(merge);
    expect(screen.getByRole('dialog', { name: /pull requests/ }).textContent).toContain(
      'The 1 above stay open',
    );
  });
});
