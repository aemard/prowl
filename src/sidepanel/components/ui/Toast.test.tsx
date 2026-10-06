import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, MAX_TOASTS, showToast, ToastRegion, toasts } from './Toast';

const show = (...args: Parameters<typeof showToast>) => {
  let id = '';
  act(() => {
    id = showToast(...args);
  });
  return id;
};

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toasts.value = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a polite live region mounted while empty', () => {
    render(<ToastRegion />);
    const region = screen.getByRole('region', { name: 'Messages' });
    const live = region.querySelector('[aria-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.children).toHaveLength(0);
  });

  it('shows a message with a tone icon and dismisses it', () => {
    render(<ToastRegion />);
    show({ message: 'Approved #42', tone: 'success' });
    const toast = screen.getByText('Approved #42').closest('.ui-toast') as HTMLElement;
    expect(toast.dataset.tone).toBe('success');
    expect(toast.querySelector('.ui-toast__icon svg')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Approved #42')).toBeNull();
  });

  it('auto-dismisses after its duration (longer for errors)', () => {
    render(<ToastRegion />);
    show({ message: 'Copied branch name' });
    show({ message: 'Merge failed', tone: 'danger' });
    expect(toasts.value.map((t) => t.durationMs)).toEqual([5000, 8000]);
    advance(5000);
    expect(screen.queryByText('Copied branch name')).toBeNull();
    expect(screen.getByText('Merge failed')).toBeTruthy();
    advance(3000);
    expect(screen.queryByText('Merge failed')).toBeNull();
  });

  it('keeps sticky toasts until dismissed', () => {
    render(<ToastRegion />);
    const id = show({ message: 'Rate limited until 14:05', durationMs: 0 });
    advance(60_000);
    expect(screen.getByText('Rate limited until 14:05')).toBeTruthy();
    act(() => dismissToast(id));
    expect(toasts.value).toEqual([]);
  });

  it('pauses while hovered or focused and resumes with the remaining time', () => {
    render(<ToastRegion />);
    show({ message: 'Approved #42', durationMs: 1000 });
    const toast = screen.getByText('Approved #42').closest('.ui-toast') as HTMLElement;
    advance(600);
    fireEvent.pointerEnter(toast);
    fireEvent.pointerEnter(toast);
    advance(5000);
    expect(screen.getByText('Approved #42')).toBeTruthy();
    fireEvent.pointerLeave(toast);
    fireEvent.focusIn(toast);
    advance(5000);
    expect(screen.getByText('Approved #42')).toBeTruthy();
    fireEvent.focusOut(toast);
    advance(399);
    expect(screen.getByText('Approved #42')).toBeTruthy();
    advance(1);
    expect(screen.queryByText('Approved #42')).toBeNull();
  });

  it('runs its action once and dismisses', () => {
    const onClick = vi.fn();
    render(<ToastRegion />);
    show({ message: 'Snoozed for 1 hour', action: { label: 'Undo', onClick } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText('Snoozed for 1 hour')).toBeNull();
  });

  it(`shows at most ${MAX_TOASTS} toasts, dropping the oldest`, () => {
    render(<ToastRegion />);
    for (const n of [1, 2, 3, 4]) show({ message: `Toast ${n}` });
    expect(screen.queryByText('Toast 1')).toBeNull();
    expect(screen.getAllByText(/^Toast/)).toHaveLength(MAX_TOASTS);
    expect(new Set(toasts.value.map((t) => t.id)).size).toBe(MAX_TOASTS);
    expect(toasts.value[0]?.tone).toBe('info');
  });
});
