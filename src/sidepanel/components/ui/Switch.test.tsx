import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { Switch, type SwitchProps } from './Switch';

function Controlled(props: Partial<SwitchProps>) {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      label="Notify on new reviews"
      {...props}
      checked={checked}
      onChange={(next) => {
        props.onChange?.(next);
        setChecked(next);
      }}
    />
  );
}

describe('Switch', () => {
  it('is a switch named by its visible label', () => {
    render(<Controlled description="Also when a review is dismissed." />);
    const control = screen.getByRole('switch', { name: 'Notify on new reviews' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.getAttribute('type')).toBe('button');
    const description = document.getElementById(control.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Also when a review is dismissed.');
  });

  it('toggles on click and from its label', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const control = screen.getByRole('switch');
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(control.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByText('Notify on new reviews'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('can hide its label visually, take an id and be disabled', () => {
    const onChange = vi.fn();
    render(
      <Switch
        id="quiet"
        label="Quiet hours"
        hideLabel
        disabled
        checked
        onChange={onChange}
        class="x"
      />,
    );
    const control = screen.getByRole('switch', { name: 'Quiet hours' });
    expect(control.id).toBe('quiet');
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByText('Quiet hours').parentElement?.classList.contains('sr-only')).toBe(true);
    expect(control.closest('.ui-switch-field')?.getAttribute('class')).toBe('ui-switch-field x');
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
