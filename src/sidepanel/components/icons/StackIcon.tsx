import type { IconProps } from './Icon';

const svgProps = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.5',
  'stroke-linejoin': 'round',
  'stroke-linecap': 'round',
  focusable: 'false',
} as const;

const layers = (
  <>
    <path d="M8 1.75L14.25 5 8 8.25 1.75 5z" fill="currentColor" fill-opacity="0.25" />
    <path d="M1.75 8L8 11.25 14.25 8" />
    <path d="M1.75 11L8 14.25 14.25 11" />
  </>
);

/**
 * A GitHub stack: sheets layered on each other, the top one tinted. Prowl's own drawing (not an
 * Octicon), stroked rather than filled so it stays clear at 16 px; `currentColor` like the rest.
 */
export function StackIcon({ size = 16, label, class: className }: IconProps) {
  const cls = className ? `icon ${className}` : 'icon';
  if (label)
    return (
      <svg {...svgProps} class={cls} width={size} height={size} role="img" aria-label={label}>
        <title>{label}</title>
        {layers}
      </svg>
    );
  return (
    <svg {...svgProps} class={cls} width={size} height={size} aria-hidden="true">
      {layers}
    </svg>
  );
}
