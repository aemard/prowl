import { cx } from './cx';
import './Skeleton.css';

export interface SkeletonProps {
  /** `text` = one line of body text (default), `circle` = avatar, `rect` = block. */
  shape?: 'text' | 'circle' | 'rect';
  /** CSS length or px number. Defaults: text 100%, circle 20 px, rect 100%. */
  width?: string | number;
  /** CSS length or px number. Defaults: text 1 line, circle = width, rect 48 px. */
  height?: string | number;
  class?: string;
}

const length = (value: string | number | undefined) =>
  typeof value === 'number' ? `${value}px` : value;

/**
 * Placeholder shape while content loads. Always hidden from assistive tech: mark the loading
 * container with `aria-busy="true"` and give it a label instead.
 */
export function Skeleton({ shape = 'text', width, height, class: className }: SkeletonProps) {
  const style: Record<string, string> = {};
  const w = length(width);
  const h = length(height);
  if (w) style['--skeleton-width'] = w;
  if (h) style['--skeleton-height'] = h;
  return (
    <span
      class={cx('ui-skeleton', className)}
      data-shape={shape}
      style={style}
      aria-hidden="true"
    />
  );
}
