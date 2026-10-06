import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { RepoFilter } from './RepoFilter';

function setup(patterns: string[] = []) {
  const onChange = vi.fn();
  render(<RepoFilter name="Include" hint="Only these." patterns={patterns} onChange={onChange} />);
  const input = screen.getByLabelText('Include repository') as HTMLInputElement;
  const add = (text: string) => {
    fireEvent.input(input, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to include list' }));
  };
  return { input, onChange, add };
}

describe('RepoFilter', () => {
  it('lists the patterns as chips under a named group', () => {
    setup(['acme', 'acme/widgets']);
    const group = screen.getByRole('group', { name: 'Include' });
    expect(group.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Only these.')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'acme',
      'acme/widgets',
    ]);
  });

  it('adds a trimmed owner or owner/name and clears the field', () => {
    const { input, onChange, add } = setup(['acme']);
    add('  octo-org/repo.name ');
    expect(onChange).toHaveBeenCalledWith(['acme', 'octo-org/repo.name']);
    expect(input.value).toBe('');
    expect(screen.getByRole('status').textContent).toBe(
      'Added octo-org/repo.name to the include list.',
    );
  });

  it.each(['', 'a/b/c', 'not a repo', '-bad', 'acme/..'])('rejects %j', (text) => {
    const { input, onChange, add } = setup();
    add(text);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter an owner or owner\/name/)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('rejects a pattern that is already there, whatever its case', () => {
    const { onChange, add } = setup(['Acme/Widgets']);
    add('acme/widgets');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('acme/widgets is already in the include list.')).toBeTruthy();
  });

  it('clears the error as soon as the text changes', () => {
    const { input, add } = setup();
    add('nope nope');
    fireEvent.input(input, { target: { value: 'ok' } });
    expect(screen.queryByText(/Enter an owner/)).toBeNull();
  });

  it('removes a chip, announces it and keeps the keyboard in the field', () => {
    const { input, onChange } = setup(['acme', 'octo/hello']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove acme' }));
    expect(onChange).toHaveBeenCalledWith(['octo/hello']);
    expect(screen.getByRole('status').textContent).toBe('Removed acme from the include list.');
    expect(document.activeElement).toBe(input);
  });
});
