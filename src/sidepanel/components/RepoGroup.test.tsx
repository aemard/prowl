import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { RepoGroup } from './RepoGroup';

const card = (title: string) => <li key={title}>{title}</li>;

describe('RepoGroup', () => {
  it('names its button by the repository and the count, and lists the cards under it', () => {
    render(
      <ul>
        <RepoGroup repo="acme/web" count={2} expanded onToggle={() => {}}>
          {[card('One'), card('Two')]}
        </RepoGroup>
      </ul>,
    );
    const heading = screen.getByRole('heading', { name: 'acme/web 2 pull requests' });
    const button = within(heading).getByRole('button', { name: 'acme/web 2 pull requests' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // The list it controls is labelled with the repository.
    const list = screen.getByRole('list', { name: 'acme/web pull requests' });
    expect(button.getAttribute('aria-controls')).toBe(list.id);
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    // Lists nest properly: the group is an item of the outer list.
    expect(screen.getAllByRole('list')).toHaveLength(2);
  });

  it('says "1 pull request" for one, and keeps a long name whole for assistive tech', () => {
    const long = 'northwind-engineering/internal-platform-services-monorepo';
    render(
      <ul>
        <RepoGroup repo={long} count={1} expanded onToggle={() => {}}>
          {card('Only')}
        </RepoGroup>
      </ul>,
    );
    const button = screen.getByRole('button', { name: `${long} 1 pull request` });
    expect(within(button).getByText(long).getAttribute('title')).toBe(long);
  });

  it('renders no cards while folded, and no aria-controls pointing at them', () => {
    const onToggle = vi.fn();
    render(
      <ul>
        <RepoGroup repo="acme/api" count={3} expanded={false} onToggle={onToggle}>
          {card('Hidden by the fold')}
        </RepoGroup>
      </ul>,
    );
    const button = screen.getByRole('button', { name: 'acme/api 3 pull requests' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryByText('Hidden by the fold')).toBeNull();
    expect(screen.queryByRole('list', { name: 'acme/api pull requests' })).toBeNull();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
