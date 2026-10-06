import { useId } from 'preact/hooks';
import { cx } from './cx';
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label, sentence case: "Notify on new reviews". */
  label: string;
  /** Muted helper text under the label; also the accessible description. */
  description?: string;
  /** Keep the label for assistive tech only (when a row heading already says it). */
  hideLabel?: boolean;
  disabled?: boolean;
  id?: string;
  class?: string;
}

/** On/off setting that applies immediately. The thumb position, not only color, shows state. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  hideLabel = false,
  disabled = false,
  id,
  class: className,
}: SwitchProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const labelId = `${controlId}-label`;
  const descriptionId = `${controlId}-description`;
  return (
    <div class={cx('ui-switch-field', className)} data-disabled={disabled || undefined}>
      <span class={cx('ui-switch-field__text', hideLabel && 'sr-only')}>
        <label id={labelId} for={controlId} class="ui-switch-field__label">
          {label}
        </label>
        {description && (
          <span id={descriptionId} class="ui-switch-field__description">
            {description}
          </span>
        )}
      </span>
      <button
        id={controlId}
        type="button"
        role="switch"
        class="ui-switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span class="ui-switch__track">
          <span class="ui-switch__thumb" />
        </span>
      </button>
    </div>
  );
}
