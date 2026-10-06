import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { cx, focusableIn } from './cx';

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(cx()).toBe('');
  });
});

/** Appends an element built with the DOM API (for markup JSX lint rules rightly reject). */
function append(parent: Element, tag: string, attributes: Record<string, string>) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  parent.append(el);
}

describe('focusableIn', () => {
  it('returns keyboard-focusable descendants in DOM order', () => {
    const { container } = render(
      <div>
        <a href="#docs" id="docs">
          Docs
        </a>
        <button type="button" id="ok">
          OK
        </button>
        <button type="button" disabled>
          Disabled
        </button>
        <button type="button" hidden>
          Hidden
        </button>
        <input id="field" aria-label="Field" />
        <input type="hidden" />
        <select id="pick" aria-label="Pick" />
        <textarea id="area" aria-label="Area" />
      </div>,
    );
    const root = container.firstElementChild as Element;
    append(root, 'a', { id: 'no-href' });
    append(root, 'span', { id: 'custom', tabindex: '0' });
    append(root, 'span', { id: 'programmatic', tabindex: '-1' });
    expect(focusableIn(container).map((el) => el.id)).toEqual([
      'docs',
      'ok',
      'field',
      'pick',
      'area',
      'custom',
    ]);
  });

  it('handles a missing root', () => {
    expect(focusableIn(null)).toEqual([]);
    expect(focusableIn(undefined)).toEqual([]);
  });
});
