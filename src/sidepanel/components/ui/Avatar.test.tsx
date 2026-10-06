import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows the image as a decorative, lazily decoded 20 px picture', () => {
    const { container } = render(
      <Avatar src="https://example.com/a.png" title="alice" class="x" />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/a.png');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('class')).toBe('ui-avatar x');
    expect(screen.getByTitle('alice')).toBe(img);
  });

  it('falls back to a person icon without a source, hidden from assistive tech', () => {
    const { container } = render(<Avatar src={null} />);
    expect(container.querySelector('img')).toBeNull();
    const fallback = container.querySelector('.ui-avatar');
    expect(fallback?.getAttribute('aria-hidden')).toBe('true');
    expect(fallback?.querySelector('svg')).toBeTruthy();
  });
});
