import { act, fireEvent, render, screen } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';

type Overrides = Partial<DialogProps> & { withFocusTarget?: boolean };

function Harness({ withFocusTarget, ...overrides }: Overrides) {
  const [open, setOpen] = useState(false);
  const target = useRef<HTMLInputElement>(null);
  const close = () => {
    overrides.onClose?.();
    setOpen(false);
  };
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        title="Request changes"
        description="Explain what needs to change."
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="danger">Request changes</Button>
          </>
        }
        initialFocus={withFocusTarget ? target : undefined}
        {...overrides}
        open={overrides.open ?? open}
        onClose={close}
      >
        <button type="button">First in body</button>
        <input ref={target} aria-label="Message" />
      </Dialog>
    </main>
  );
}

const opener = () => screen.getByRole('button', { name: 'Open' });
const dialog = () => document.querySelector('dialog') as HTMLDialogElement;

function openDialog(overrides: Overrides = {}) {
  render(<Harness {...overrides} />);
  opener().focus();
  fireEvent.click(opener());
  return dialog();
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(dialog()).toBeNull();
  });

  it('opens modally with a name, description and the first body control focused', () => {
    const el = openDialog();
    expect(el.open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Request changes' })).toBe(el);
    const description = document.getElementById(el.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Explain what needs to change.');
    expect(document.activeElement?.textContent).toBe('First in body');
  });

  it('focuses initialFocus when given', () => {
    openDialog({ withFocusTarget: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  });

  it('falls back to the dialog itself when nothing inside is focusable', () => {
    render(<Dialog open title="Info" onClose={() => {}} closeOnBackdrop={false} />);
    expect(document.activeElement).toBe(dialog());
    expect(dialog().getAttribute('aria-describedby')).toBeNull();
    expect(dialog().querySelector('.ui-dialog__body')).toBeNull();
  });

  it('closes on Esc (cancel) and restores focus to the opener', () => {
    const onClose = vi.fn();
    const el = openDialog({ onClose });
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      el.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('keeps Esc to itself: what contains the dialog in the DOM never sees the key', () => {
    const outside = vi.fn();
    const { container } = render(
      <Dialog open title="Message" onClose={() => {}}>
        <input aria-label="Message" />
      </Dialog>,
    );
    container.addEventListener('keydown', outside);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(outside).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'a' });
    expect(outside).toHaveBeenCalledOnce();
  });

  it('closes from the close button and footer actions', () => {
    const onClose = vi.fn();
    openDialog({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
  });

  it('closes on a backdrop click, but not on clicks or drags that start inside', () => {
    const onClose = vi.fn();
    const el = openDialog({ onClose });
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.pointerDown(input);
    fireEvent.click(el);
    fireEvent.pointerDown(el);
    fireEvent.click(input);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(el);
    fireEvent.click(el);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores backdrop clicks when closeOnBackdrop is false', () => {
    const onClose = vi.fn();
    const el = openDialog({ onClose, closeOnBackdrop: false });
    fireEvent.pointerDown(el);
    fireEvent.click(el);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the browser closes the native dialog', () => {
    const onClose = vi.fn();
    const el = openDialog({ onClose });
    act(() => {
      el.dispatchEvent(new Event('close'));
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it('does not report its own cleanup as a close request', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open title="T" onClose={onClose} />);
    const el = dialog();
    rerender(<Dialog open={false} title="T" onClose={onClose} />);
    expect(el.open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('traps Tab and Shift+Tab inside', () => {
    const el = openDialog();
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getAllByRole('button', { name: 'Request changes' }).at(-1) as HTMLElement;
    last.focus();
    fireEvent.keyDown(el, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(el, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Tab in the middle is left to the browser.
    const input = screen.getByRole('textbox', { name: 'Message' });
    input.focus();
    const middle = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(document.activeElement).toBe(input);
  });

  it('wraps Shift+Tab from the dialog itself and swallows Tab with nothing to focus', () => {
    render(<Dialog open title="Info" onClose={() => {}} />);
    const el = dialog();
    for (const button of el.querySelectorAll('button')) button.remove();
    el.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    el.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
  });

  it('moves Shift+Tab from the focused dialog to the last control', () => {
    render(
      <Dialog open title="Info" onClose={() => {}}>
        <p>Text only</p>
      </Dialog>,
    );
    const el = dialog();
    el.focus();
    fireEvent.keyDown(el, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });
});
