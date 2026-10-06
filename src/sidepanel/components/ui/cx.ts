/** Joins class names, skipping falsy parts. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** State hues from tokens.css. Never the only signal: pair with an icon or text. */
export type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'attention' | 'done';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keyboard-focusable descendants of `root`, in DOM order. */
export function focusableIn(root: ParentNode | null | undefined): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden) : [];
}
