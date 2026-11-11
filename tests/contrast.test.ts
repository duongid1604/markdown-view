import { describe, expect, it } from 'vitest';
import { accessibleColors, readable } from '../src/contrast';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe('code color contrast', () => {
  it('lifts dark-mode tokens to 7:1 on the code background', () => {
    expect(ratio(readable('#4c9a91', 'dark'), '#252527')).toBeGreaterThanOrEqual(7);
  });

  it('flattens translucent colors before measuring them', () => {
    const out = readable('#c98a7d77', 'dark');
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(ratio(out, '#252527')).toBeGreaterThanOrEqual(7);
  });

  it('keeps light mode at the AA floor', () => {
    expect(ratio(readable('#999999', 'light'), '#f7f7f5')).toBeGreaterThanOrEqual(4.5);
  });

  it('rewrites 6- and 8-digit Shiki variables', () => {
    const html = accessibleColors('<span style="--shiki-light:#999999;--shiki-dark:#c98a7d77">x</span>');
    expect(html).not.toContain('#c98a7d77');
    expect(html).not.toContain('#999999');
  });
});
