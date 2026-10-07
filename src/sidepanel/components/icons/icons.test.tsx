import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createIcon } from './Icon';
import * as icons from './index';
import { ProwlMark } from './ProwlMark';

const root = resolve(import.meta.dirname, '../../../..');

describe('createIcon', () => {
  const Dot = createIcon('M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z');

  it('is decorative by default', () => {
    const { container } = render(<Dot />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('class')).toBe('icon');
  });

  it('becomes an image with an accessible name when labelled', () => {
    render(<Dot label="Checks pending" size={12} class="extra" />);
    const img = screen.getByRole('img', { name: 'Checks pending' });
    expect(img.getAttribute('aria-hidden')).toBeNull();
    expect(img.getAttribute('width')).toBe('12');
    expect(img.getAttribute('class')).toBe('icon extra');
    expect(img.querySelector('title')?.textContent).toBe('Checks pending');
  });
});

describe('icon set', () => {
  const entries = Object.entries(icons);

  it('exports Octicons-backed components named *Icon', () => {
    expect(entries.length).toBeGreaterThanOrEqual(30);
    for (const [name] of entries) expect(name).toMatch(/^[A-Z][A-Za-z]*Icon$/);
  });

  it.each(entries)('%s renders a 16 px path', (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^[Mm][\d.]/);
  });
});

describe('ProwlMark', () => {
  it('is decorative next to the product name', () => {
    const { container } = render(<ProwlMark />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('width')).toBe('20');
    expect(img?.getAttribute('src')).toMatch(/logo\.svg$/);
  });

  it('can stand alone with a name', () => {
    render(<ProwlMark label="Prowl" size={32} class="hero" />);
    const img = screen.getByRole('img', { name: 'Prowl' });
    expect(img.getAttribute('class')).toBe('prowl-mark hero');
    expect(img.getAttribute('height')).toBe('32');
  });

  it('ships a square, named logo that pnpm icons can rasterize', () => {
    const logo = readFileSync(resolve(root, 'src/assets/logo.svg'), 'utf8');
    expect(logo).toMatch(/^<svg [^>]*viewBox="0 0 128 128"/);
    expect(logo).toContain('<title>Prowl</title>');
  });
});
