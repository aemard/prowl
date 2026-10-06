import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { CheckCircleFillIcon, InfoIcon, XCircleFillIcon, XIcon } from '../icons';
import { Button } from './Button';
import { IconButton } from './IconButton';
import './Toast.css';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastOptions {
  /** One short sentence: "Approved #42", "Merge failed: base branch was modified". */
  message: string;
  /** Sets the icon and accent color (default `info`). */
  tone?: ToastTone;
  /** One optional action, e.g. Undo or Retry. Activating it dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss delay; 0 keeps it until dismissed. Default 5000, 8000 for `danger`. */
  durationMs?: number;
}

export interface Toast extends Required<Omit<ToastOptions, 'action'>> {
  id: string;
  action?: ToastOptions['action'];
}

/** At most this many toasts are shown; older ones are dropped. */
export const MAX_TOASTS = 3;

/** Visible toasts, oldest first. Shared state; use showToast/dismissToast to change it. */
export const toasts = signal<Toast[]>([]);
let sequence = 0;

export function showToast(options: ToastOptions): string {
  const tone = options.tone ?? 'info';
  const toast: Toast = {
    id: `toast-${++sequence}`,
    message: options.message,
    tone,
    action: options.action,
    durationMs: options.durationMs ?? (tone === 'danger' ? 8000 : 5000),
  };
  toasts.value = [...toasts.value, toast].slice(-MAX_TOASTS);
  return toast.id;
}

export function dismissToast(id: string): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

const ICONS = { info: InfoIcon, success: CheckCircleFillIcon, danger: XCircleFillIcon };

/**
 * Polite live region for transient feedback. Mount once, near the end of the app; it stays in
 * the DOM while empty so screen readers announce what is added later.
 */
export function ToastRegion() {
  return (
    <section class="ui-toast-region" aria-label="Messages">
      <div class="ui-toast-region__list" aria-live="polite" aria-relevant="additions text">
        {toasts.value.map((toast) => (
          <ToastView key={toast.id} toast={toast} />
        ))}
      </div>
    </section>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(0);

  const start = () => {
    if (toast.durationMs <= 0 || timer.current !== undefined) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => dismissToast(toast.id), remaining.current);
  };
  // Hovering or focusing a toast pauses its timer (WCAG 2.2.1).
  const pause = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  };

  useEffect(() => {
    start();
    return pause;
  }, []);

  const Icon = ICONS[toast.tone];
  const { action } = toast;
  return (
    <div
      class="ui-toast"
      data-tone={toast.tone}
      onPointerEnter={pause}
      onPointerLeave={start}
      onFocusIn={pause}
      onFocusOut={start}
    >
      <span class="ui-toast__icon">
        <Icon />
      </span>
      <p class="ui-toast__message">{toast.message}</p>
      {action && (
        <Button
          size="sm"
          variant="ghost"
          class="ui-toast__action"
          onClick={() => {
            dismissToast(toast.id);
            action.onClick();
          }}
        >
          {action.label}
        </Button>
      )}
      <IconButton label="Dismiss" size="sm" onClick={() => dismissToast(toast.id)}>
        <XIcon />
      </IconButton>
    </div>
  );
}
