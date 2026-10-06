import './ProwlMark.css';

/** Geometry of the Prowl mark, shared with src/assets/logo.svg (a test keeps them in sync). */
export const PROWL_MARK = {
  radius: 28,
  eye: 'M10 64Q64 4 118 64Q64 124 10 64Z',
  pupil: 'M64 44Q84 64 64 84Q44 64 64 44Z',
} as const;

export interface ProwlMarkProps {
  /** Rendered size in px (default 20). */
  size?: number;
  /** Accessible name; omit when the word "Prowl" is next to the mark. */
  label?: string;
  class?: string;
}

/** The Prowl logo: a cat's eye keeping watch, on the brand tile. Colors come from tokens. */
export function ProwlMark({ size = 20, label, class: className }: ProwlMarkProps) {
  const content = [
    <rect key="tile" class="prowl-mark__tile" width="128" height="128" rx={PROWL_MARK.radius} />,
    <path key="eye" class="prowl-mark__eye" d={PROWL_MARK.eye} />,
    <path key="pupil" class="prowl-mark__pupil" d={PROWL_MARK.pupil} />,
  ];
  const svgProps = {
    class: className ? `prowl-mark ${className}` : 'prowl-mark',
    width: size,
    height: size,
    viewBox: '0 0 128 128',
    focusable: 'false',
  } as const;
  if (label) {
    return (
      <svg {...svgProps} role="img" aria-label={label}>
        <title>{label}</title>
        {content}
      </svg>
    );
  }
  return (
    <svg {...svgProps} aria-hidden="true">
      {content}
    </svg>
  );
}
