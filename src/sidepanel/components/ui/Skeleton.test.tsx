import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('is hidden from assistive tech and defaults to a text line', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.dataset.shape).toBe('text');
    expect(el.style.getPropertyValue('--skeleton-width')).toBe('');
  });

  it('sizes itself through custom properties', () => {
    const { container } = render(
      <div>
        <Skeleton shape="circle" width={20} />
        <Skeleton shape="rect" width="60%" height="3rem" class="x" />
      </div>,
    );
    const [circle, rect] = [...container.querySelectorAll<HTMLElement>('.ui-skeleton')];
    expect(circle?.dataset.shape).toBe('circle');
    expect(circle?.style.getPropertyValue('--skeleton-width')).toBe('20px');
    expect(rect?.style.getPropertyValue('--skeleton-width')).toBe('60%');
    expect(rect?.style.getPropertyValue('--skeleton-height')).toBe('3rem');
    expect(rect?.getAttribute('class')).toBe('ui-skeleton x');
  });
});
