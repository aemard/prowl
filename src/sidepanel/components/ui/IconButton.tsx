import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { busyGuard } from './Button';
import { cx } from './cx';
import { Spinner } from './Spinner';
import './IconButton.css';

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'class' | 'className' | 'size' | 'label' | 'aria-label' | 'title' | 'children' | 'loading'
>;

export interface IconButtonProps extends NativeButtonProps {
  /** Required accessible name: becomes `aria-label` and the tooltip. */
  label: string;
  /** The icon (decorative; the label names the button). */
  children: ComponentChildren;
  /** Default `ghost`. */
  variant?: 'ghost' | 'secondary';
  /** `sm` = 24 px square (dense rows), `md` = 28 px (default). */
  size?: 'sm' | 'md';
  /** Toggle buttons: sets `aria-pressed`. */
  pressed?: boolean;
  loading?: boolean;
  class?: string;
}

export function IconButton({
  label,
  children,
  variant = 'ghost',
  size = 'md',
  pressed,
  loading = false,
  class: className,
  type = 'button',
  onClick,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      class={cx('ui-icon-button', className)}
      data-variant={variant}
      data-size={size}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      onClick={busyGuard(loading, onClick)}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 16} /> : children}
    </button>
  );
}
