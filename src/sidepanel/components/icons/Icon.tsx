import type { JSX } from 'preact';
import './Icon.css';

export type IconSize = 12 | 16 | 20 | 24;

export interface IconProps {
  /** Rendered size in px (default 16). Paths are drawn on a 16 px grid. */
  size?: IconSize;
  /** Accessible name. Without one the icon is decorative and hidden from assistive tech. */
  label?: string;
  class?: string;
}

export type IconComponent = (props: IconProps) => JSX.Element;

/** Wraps a 16 px SVG path in a `currentColor` icon component. */
export function createIcon(path: string): IconComponent {
  return function Icon({ size = 16, label, class: className }: IconProps) {
    const svgProps = {
      class: className ? `icon ${className}` : 'icon',
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'currentColor',
      focusable: 'false',
    } as const;
    if (label) {
      return (
        <svg {...svgProps} role="img" aria-label={label}>
          <title>{label}</title>
          <path d={path} />
        </svg>
      );
    }
    return (
      <svg {...svgProps} aria-hidden="true">
        <path d={path} />
      </svg>
    );
  };
}
