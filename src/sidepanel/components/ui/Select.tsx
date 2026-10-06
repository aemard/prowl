import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { ChevronDownIcon } from '../icons';
import { cx } from './cx';
import { describedBy, Field } from './Field';
import './Select.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  hint?: ComponentChildren;
  error?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  class?: string;
}

/** Native `<select>` (keyboard, screen readers and the OS picker for free), styled like TextField. */
export function Select<T extends string>({
  label,
  value,
  options,
  onValueChange,
  hint,
  error,
  hideLabel,
  disabled,
  id,
  name,
  class: className,
}: SelectProps<T>) {
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Field
      controlId={controlId}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      class={cx('ui-select', className)}
    >
      <div class="ui-select__wrap">
        <select
          id={controlId}
          name={name}
          class="ui-control ui-select__control"
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(controlId, hint, error)}
          onChange={(event) => {
            const next = options.find((o) => o.value === event.currentTarget.value);
            if (next) onValueChange(next.value);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span class="ui-select__chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </div>
    </Field>
  );
}
