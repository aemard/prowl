import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { CheckIcon } from '../icons';
import { Badge } from './Badge';

describe('Badge', () => {
  it('defaults to a neutral, subtle, medium pill', () => {
    render(<Badge>Draft</Badge>);
    const badge = screen.getByText('Draft').parentElement;
    expect(badge?.getAttribute('class')).toBe('ui-badge');
    expect(badge?.dataset).toMatchObject({ tone: 'neutral', variant: 'subtle', size: 'md' });
  });

  it('accepts tone, variant, size, icon and a title', () => {
    render(
      <Badge
        tone="success"
        variant="solid"
        size="sm"
        icon={<CheckIcon size={12} />}
        title="2 approvals"
        class="x"
      >
        2
      </Badge>,
    );
    const badge = screen.getByTitle('2 approvals');
    expect(badge.dataset).toMatchObject({ tone: 'success', variant: 'solid', size: 'sm' });
    expect(badge.getAttribute('class')).toBe('ui-badge x');
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(badge.textContent).toBe('2');
  });
});
