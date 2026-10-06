import { fireEvent, render, screen } from '@testing-library/preact';
import { createRef } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { SearchIcon } from '../icons';
import { TextField } from './TextField';

describe('TextField', () => {
  it('labels the input and reports typed values', () => {
    const onValueChange = vi.fn();
    render(<TextField label="Personal access token" value="" onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox', { name: 'Personal access token' });
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
    fireEvent.input(input, { target: { value: 'ghp_x' } });
    expect(onValueChange).toHaveBeenCalledWith('ghp_x');
  });

  it('links hint and error, and marks the field invalid', () => {
    render(
      <TextField
        label="Repository"
        value="bad repo"
        onValueChange={() => {}}
        hint="owner or owner/name"
        error="Use owner or owner/name"
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Repository' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Use owner or owner/name',
      'owner or owner/name',
    ]);
    expect(document.querySelector('.ui-field__error svg')).not.toBeNull();
    expect(input.closest('.ui-field')?.hasAttribute('data-invalid')).toBe(true);
  });

  it('supports a leading icon, a hidden label, an id and a ref', () => {
    const ref = createRef<HTMLElement>();
    render(
      <TextField
        id="filter"
        label="Filter pull requests"
        hideLabel
        type="search"
        icon={<SearchIcon />}
        placeholder="Filter"
        value=""
        onValueChange={() => {}}
        inputRef={ref}
        class="x"
      />,
    );
    const input = screen.getByRole('searchbox', { name: 'Filter pull requests' });
    expect(input.id).toBe('filter');
    expect(ref.current).toBe(input);
    expect(input.getAttribute('placeholder')).toBe('Filter');
    expect(screen.getByText('Filter pull requests').classList.contains('sr-only')).toBe(true);
    expect(document.querySelector('.ui-text-field__wrap')?.hasAttribute('data-icon')).toBe(true);
    expect(document.querySelector('.ui-text-field__icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(input.closest('.ui-field')?.getAttribute('class')).toBe('ui-field ui-text-field x');
  });

  it('renders a textarea when multiline', () => {
    const onValueChange = vi.fn();
    const ref = createRef<HTMLElement>();
    render(
      <TextField
        label="Comment"
        multiline
        rows={5}
        value="Looks good"
        onValueChange={onValueChange}
        inputRef={ref}
        required
      />,
    );
    const area = screen.getByRole('textbox', { name: 'Comment' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(ref.current).toBe(area);
    expect(area.getAttribute('rows')).toBe('5');
    expect((area as HTMLTextAreaElement).required).toBe(true);
    fireEvent.input(area, { target: { value: 'Looks great' } });
    expect(onValueChange).toHaveBeenCalledWith('Looks great');
  });
});
