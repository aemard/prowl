import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { CheckIcon } from '../icons';
import { Button } from './Button';

describe('Button', () => {
  it('renders a secondary, medium, non-submitting button by default', () => {
    render(<Button>Refresh</Button>);
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.dataset.variant).toBe('secondary');
    expect(button.dataset.size).toBe('md');
    expect(button.getAttribute('class')).toBe('ui-button');
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)('supports the %s variant', (v) => {
    render(
      <Button variant={v} size="sm" class="extra">
        Go
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.dataset.variant).toBe(v);
    expect(button.dataset.size).toBe('sm');
    expect(button.getAttribute('class')).toBe('ui-button extra');
  });

  it('calls onClick and forwards native attributes', () => {
    const onClick = vi.fn();
    render(
      <Button
        onClick={onClick}
        type="submit"
        title="Approve this pull request"
        icon={<CheckIcon />}
      >
        Approve
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.getAttribute('title')).toBe('Approve this pull request');
    expect(button.querySelector('svg.icon')).not.toBeNull();
  });

  it('stays focusable but inert while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} icon={<CheckIcon />}>
        Merge
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Merge' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.querySelector('.ui-spinner')).not.toBeNull();
    expect(button.querySelector('.icon')).toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('uses a small spinner in small buttons', () => {
    render(
      <Button loading size="sm">
        Save
      </Button>,
    );
    expect(document.querySelector('.ui-spinner')?.getAttribute('width')).toBe('12');
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Merge
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
