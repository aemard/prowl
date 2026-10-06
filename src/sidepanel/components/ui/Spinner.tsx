import { cx } from './cx';
import './Spinner.css';

export interface SpinnerProps {
  /** Diameter in px (default 16). */
  size?: 12 | 16 | 20 | 24;
  /** Announced as a status message. Omit inside a control that already says it is busy. */
  label?: string;
  class?: string;
}

/** Indeterminate progress. Keeps turning (slowly) under reduced motion: it is essential feedback. */
export function Spinner({ size = 16, label, class: className }: SpinnerProps) {
  const svg = (
    <svg
      class={cx('ui-spinner', !label && className)}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle class="ui-spinner__track" cx="8" cy="8" r="6.5" />
      <path class="ui-spinner__arc" d="M8 1.5A6.5 6.5 0 0 1 14.5 8" />
    </svg>
  );
  if (!label) return svg;
  return (
    <span class={cx('ui-spinner-status', className)} role="status">
      {svg}
      <span class="sr-only">{label}</span>
    </span>
  );
}
