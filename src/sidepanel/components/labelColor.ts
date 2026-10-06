/**
 * GitHub label colors are chosen by users, so text on them cannot come from design tokens:
 * `labelColors` picks white when it reaches AA (4.5:1) on the label color and black otherwise.
 * Black then has at least 4.67:1, so the text always passes AA. These two literals are runtime
 * data for inline custom properties, not stylesheet colors.
 */
const BLACK = '#000000';
const WHITE = '#ffffff';
/** WCAG AA for normal text. */
const AA = 4.5;

/** WCAG relative luminance of a six-digit hex color (without `#`). */
export function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two relative luminances. */
export const contrast = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** `--label-bg` / `--label-fg` for a label of color `hex` (six hex digits, no `#`). */
export function labelColors(hex: string): { background: string; color: string } {
  const lum = luminance(hex);
  return {
    background: `#${hex}`,
    color: contrast(lum, 1) >= AA ? WHITE : BLACK,
  };
}
