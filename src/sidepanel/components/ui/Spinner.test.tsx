import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('is decorative without a label', () => {
    const { container } = render(<Spinner class="x" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('class')).toBe('ui-spinner x');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces its label as a status', () => {
    render(<Spinner label="Refreshing" size={20} class="x" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Refreshing');
    expect(status.getAttribute('class')).toBe('ui-spinner-status x');
    expect(status.querySelector('svg')?.getAttribute('width')).toBe('20');
  });
});
