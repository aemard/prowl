import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';

function setup(value = 2) {
  const onCommit = vi.fn();
  render(<NumberField label="Every" value={value} min={1} max={60} onCommit={onCommit} />);
  const input = screen.getByLabelText('Every') as HTMLInputElement;
  const type = (text: string) => fireEvent.input(input, { target: { value: text } });
  return { input, onCommit, type };
}

describe('NumberField', () => {
  it('shows the saved value and saves whole numbers in range as they are typed', () => {
    const { input, onCommit, type } = setup();
    expect(input.value).toBe('2');
    type('15');
    expect(onCommit).toHaveBeenCalledWith(15);
    expect(screen.queryByText(/Enter a whole number/)).toBeNull();
  });

  it.each(['0', '61', '1.5', ''])('rejects %j with the allowed range and saves nothing', (text) => {
    const { input, onCommit, type } = setup();
    type(text);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a whole number from 1 to 60.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the saved value again when the field is left', () => {
    const { input, type } = setup(5);
    type('0');
    fireEvent.blur(input);
    expect(input.value).toBe('5');
    expect(screen.queryByText(/Enter a whole number/)).toBeNull();
  });
});
