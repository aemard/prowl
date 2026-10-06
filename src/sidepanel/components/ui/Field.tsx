import type { ComponentChildren } from 'preact';
import { AlertFillIcon } from '../icons';
import { cx } from './cx';
import './Field.css';

export interface FieldProps {
  controlId: string;
  label: string;
  hint?: ComponentChildren;
  error?: string;
  hideLabel?: boolean;
  class?: string;
  children: ComponentChildren;
}

export const hintId = (controlId: string) => `${controlId}-hint`;
export const errorId = (controlId: string) => `${controlId}-error`;

/** `aria-describedby` for a control: its error first, then its hint. */
export function describedBy(controlId: string, hint: unknown, error: unknown): string | undefined {
  const ids = [error ? errorId(controlId) : '', hint ? hintId(controlId) : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/** Label, hint and error layout shared by TextField and Select. */
export function Field({
  controlId,
  label,
  hint,
  error,
  hideLabel,
  class: className,
  children,
}: FieldProps) {
  return (
    <div class={cx('ui-field', className)} data-invalid={error ? true : undefined}>
      <label for={controlId} class={cx('ui-field__label', hideLabel && 'sr-only')}>
        {label}
      </label>
      {children}
      {error && (
        <p id={errorId(controlId)} class="ui-field__error">
          <AlertFillIcon size={12} />
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId(controlId)} class="ui-field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
