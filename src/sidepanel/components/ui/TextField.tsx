import type { ComponentChildren, JSX, Ref } from 'preact';
import { useId } from 'preact/hooks';
import { cx } from './cx';
import { describedBy, Field } from './Field';
import './TextField.css';

export interface TextFieldProps {
  /** Visible label (required; use `hideLabel` to keep it for assistive tech only). */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  type?: 'text' | 'search' | 'url' | 'password' | 'email' | 'number' | 'time';
  /** Renders a `<textarea>` with `rows` lines (default 3). */
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: ComponentChildren;
  /** Error message; marks the control `aria-invalid` and shows an icon (not color alone). */
  error?: string;
  hideLabel?: boolean;
  /** Decorative leading icon, e.g. a search glass. Single-line only. */
  icon?: ComponentChildren;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
  spellcheck?: boolean;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'url' | 'search' | 'email';
  min?: number;
  max?: number;
  autoFocus?: boolean;
  /** Receives the `<input>` or `<textarea>` (for focusing it programmatically). */
  inputRef?: Ref<HTMLElement>;
  onKeyDown?: (event: JSX.TargetedKeyboardEvent<HTMLElement>) => void;
  onBlur?: (event: JSX.TargetedFocusEvent<HTMLElement>) => void;
  class?: string;
}

export function TextField({
  label,
  value,
  onValueChange,
  type = 'text',
  multiline = false,
  rows = 3,
  hint,
  error,
  hideLabel,
  icon,
  id,
  inputRef,
  class: className,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const shared = {
    ...rest,
    id: controlId,
    value,
    class: 'ui-control ui-text-field__control',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(controlId, hint, error),
    onInput: (event: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onValueChange(event.currentTarget.value),
  };
  return (
    <Field
      controlId={controlId}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      class={cx('ui-text-field', className)}
    >
      {multiline ? (
        <textarea {...shared} ref={inputRef as Ref<HTMLTextAreaElement>} rows={rows} />
      ) : (
        <div class="ui-text-field__wrap" data-icon={icon ? true : undefined}>
          {icon && (
            <span class="ui-text-field__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <input {...shared} ref={inputRef as Ref<HTMLInputElement>} type={type} />
        </div>
      )}
    </Field>
  );
}
