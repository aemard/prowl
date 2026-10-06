import { describe, expect, it } from 'vitest';
import { contrast, labelColors, luminance } from './labelColor';

describe('labelColors', () => {
  it('puts white text on dark labels and black text on light ones', () => {
    expect(labelColors('d73a4a')).toEqual({ background: '#d73a4a', color: '#ffffff' });
    expect(labelColors('0b1f3a').color).toBe('#ffffff');
    expect(labelColors('000000').color).toBe('#ffffff');
    expect(labelColors('fbca04').color).toBe('#000000');
    expect(labelColors('ffffff').color).toBe('#000000');
    expect(labelColors('e4e669').color).toBe('#000000');
  });

  it('always reaches AA (4.5:1) for normal text, over the whole color cube', () => {
    const steps = [0, 32, 64, 96, 128, 160, 192, 224, 255];
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    let worst = Number.POSITIVE_INFINITY;
    for (const r of steps)
      for (const g of steps)
        for (const b of steps) {
          const color = `${hex(r)}${hex(g)}${hex(b)}`;
          const { color: text } = labelColors(color);
          worst = Math.min(worst, contrast(luminance(color), luminance(text.slice(1))));
        }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it('matches the WCAG reference values', () => {
    expect(luminance('ffffff')).toBeCloseTo(1, 5);
    expect(luminance('000000')).toBe(0);
    expect(contrast(1, 0)).toBeCloseTo(21, 5);
  });
});
