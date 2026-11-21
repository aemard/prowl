import './ProwlMark.css';

export interface ProwlMarkProps {
  /** Rendered size in px (default 20). */
  size?: number;
  /** Accessible name; omit when the word "Prowl" is next to the mark. */
  label?: string;
  class?: string;
}

/**
 * The Prowl logo: a round ivory cat on a mint tile. Uses the 48 px toolbar icon rasterized from
 * src/assets/logo.png (`pnpm icons`): sharp at 2x for the 20 px header, 2 KB instead of 97 KB.
 */
export const LOGO_URL = '/icons/icon-48.png';

export function ProwlMark({ size = 20, label, class: className }: ProwlMarkProps) {
  return (
    <img
      class={className ? `prowl-mark ${className}` : 'prowl-mark'}
      src={LOGO_URL}
      width={size}
      height={size}
      alt={label ?? ''}
    />
  );
}
