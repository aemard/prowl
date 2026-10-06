import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { CheckIcon } from '../icons';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('takes its accessible name and tooltip from the required label', () => {
    render(
      <IconButton label="Refresh">
        <CheckIcon />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button.getAttribute('aria-label')).toBe('Refresh');
    expect(button.getAttribute('title')).toBe('Refresh');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.dataset.variant).toBe('ghost');
    expect(button.dataset.size).toBe('md');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('requires a label at the type level', () => {
    // @ts-expect-error label is required
    render(<IconButton>x</IconButton>);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('reflects toggle state, variant, size and forwards clicks', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Mute" pressed variant="secondary" size="sm" class="x" onClick={onClick}>
        <CheckIcon />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Mute' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.dataset.variant).toBe('secondary');
    expect(button.dataset.size).toBe('sm');
    expect(button.getAttribute('class')).toBe('ui-icon-button x');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows a spinner and ignores clicks while loading', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Refresh" loading onClick={onClick}>
        <CheckIcon />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.ui-spinner')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
