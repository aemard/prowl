import type { ComponentChildren } from 'preact';
import { cx, type Tone } from './cx';
import './Badge.css';

export interface BadgeProps {
  /** State hue (default `neutral`). Pair it with text or an icon, never color alone. */
  tone?: Tone;
  /** `subtle` tinted fill (default), `solid` strong fill, `outline` border only. */
  variant?: 'subtle' | 'solid' | 'outline';
  /** `sm` = 18 px (counts), `md` = 20 px (default). */
  size?: 'sm' | 'md';
  /** Decorative leading icon (12 px works best). */
  icon?: ComponentChildren;
  /** Extra context for the badge, e.g. the full meaning of a count. */
  title?: string;
  class?: string;
  children: ComponentChildren;
}

/** Pill-shaped status label or count: "Draft", "Approved", "3". */
export function Badge({
  tone = 'neutral',
  variant = 'subtle',
  size = 'md',
  icon,
  title,
  class: className,
  children,
}: BadgeProps) {
  return (
    <span
      class={cx('ui-badge', className)}
      data-tone={tone}
      data-variant={variant}
      data-size={size}
      title={title}
    >
      {icon}
      <span class="ui-badge__label">{children}</span>
    </span>
  );
}
