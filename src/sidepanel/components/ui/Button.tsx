import type { ButtonHTMLAttributes, ComponentChildren, JSX } from 'preact';
import { cx } from './cx';
import { Spinner } from './Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'class' | 'className' | 'size' | 'icon' | 'loading'
>;

export interface ButtonProps extends NativeButtonProps {
  /** Default `secondary`. One `primary` per view; `danger` for destructive actions. */
  variant?: ButtonVariant;
  /** `sm` = 24 px (dense rows), `md` = 28 px (default). */
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy` and ignores activation while staying focusable. */
  loading?: boolean;
  /** Decorative leading icon. */
  icon?: ComponentChildren;
  class?: string;
  children: ComponentChildren;
}

/** Blocks activation (and form submission) while a control is busy. */
export function busyGuard<T extends EventTarget>(
  loading: boolean,
  onClick: JSX.MouseEventHandler<T> | undefined,
): JSX.MouseEventHandler<T> | undefined {
  if (!loading) return onClick;
  return (event) => event.preventDefault();
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  class: className,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      class={cx('ui-button', className)}
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      onClick={busyGuard(loading, onClick)}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 16} /> : icon}
      <span class="ui-button__label">{children}</span>
    </button>
  );
}
