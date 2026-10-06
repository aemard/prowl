import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { InboxIcon } from '../icons';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders a title as a level 2 heading by default', () => {
    render(<EmptyState title="No pull requests" />);
    expect(screen.getByRole('heading', { level: 2, name: 'No pull requests' })).toBeTruthy();
    expect(document.querySelector('.ui-empty__icon')).toBeNull();
    expect(document.querySelector('.ui-empty__action')).toBeNull();
  });

  it('renders icon, description and action', () => {
    render(
      <EmptyState
        title="All caught up"
        headingLevel={3}
        icon={<InboxIcon size={24} />}
        description="Nothing needs your attention."
        action={<Button>Refresh</Button>}
        class="x"
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'All caught up' })).toBeTruthy();
    expect(screen.getByText('Nothing needs your attention.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(document.querySelector('.ui-empty__icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.ui-empty')?.getAttribute('class')).toBe('ui-empty x');
  });
});
