import logoUrl from '../../../assets/logo.png';
import './ProwlMark.css';

export interface ProwlMarkProps {
  /** Rendered size in px (default 20). */
  size?: number;
  /** Accessible name; omit when the word "Prowl" is next to the mark. */
  label?: string;
  class?: string;
}

/** The Prowl logo (src/assets/logo.png): a round ivory cat on a mint tile. */
export function ProwlMark({ size = 20, label, class: className }: ProwlMarkProps) {
  return (
    <img
      class={className ? `prowl-mark ${className}` : 'prowl-mark'}
      src={logoUrl}
      width={size}
      height={size}
      alt={label ?? ''}
    />
  );
}
