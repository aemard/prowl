import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

type Method = 'merge' | 'squash' | 'rebase';
const options = [
  { value: 'merge', label: 'Create a merge commit' },
  { value: 'squash', label: 'Squash and merge' },
  { value: 'rebase', label: 'Rebase and merge', disabled: true },
] as const;

describe('Select', () => {
  it('is a labelled native select with the given options', () => {
    render(
      <Select<Method>
        label="Merge method"
        value="squash"
        options={options}
        onValueChange={() => {}}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Merge method' }) as HTMLSelectElement;
    expect(select.value).toBe('squash');
    expect([...select.options].map((o) => [o.value, o.disabled])).toEqual([
      ['merge', false],
      ['squash', false],
      ['rebase', true],
    ]);
    expect(select.getAttribute('aria-describedby')).toBeNull();
    expect(document.querySelector('.ui-select__chevron')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('reports known values only', () => {
    const onValueChange = vi.fn();
    render(
      <Select<Method>
        label="Merge method"
        value="squash"
        options={options}
        onValueChange={onValueChange}
      />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'merge' } });
    expect(onValueChange).toHaveBeenCalledWith('merge');
    const rogue = document.createElement('option');
    rogue.value = 'octopus';
    select.append(rogue);
    fireEvent.change(select, { target: { value: 'octopus' } });
    expect(onValueChange).toHaveBeenCalledOnce();
  });

  it('shows hint and error, hides its label and can be disabled', () => {
    render(
      <Select<Method>
        id="method"
        name="method"
        label="Merge method"
        hideLabel
        disabled
        value="merge"
        options={options}
        onValueChange={() => {}}
        hint="Allowed by the repository"
        error="Merging is blocked"
        class="x"
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Merge method' }) as HTMLSelectElement;
    expect(select.id).toBe('method');
    expect(select.name).toBe('method');
    expect(select.disabled).toBe(true);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toBe('method-error method-hint');
    expect(screen.getByText('Merge method').classList.contains('sr-only')).toBe(true);
    expect(select.closest('.ui-field')?.getAttribute('class')).toBe('ui-field ui-select x');
  });
});
