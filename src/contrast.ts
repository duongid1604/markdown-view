/* Vitesse is a deliberately muted palette: its softest light colors fall below
   WCAG AA on our code background, and its dark colors sit near 4.5:1 while body
   text is ~11:1, which makes code hard to read next to prose. Nudge each token
   color toward black (light) or white (dark) until it reaches the floor for its
   mode, keeping its hue. Translucent colors are flattened onto the background
   first, so their real contrast is what gets measured. */
const CODE_BG = { light: '#f7f7f5', dark: '#252527' };
const MIN_CONTRAST = { light: 4.6, dark: 7 };
const fixed = new Map<string, string>();

type Mode = 'light' | 'dark';

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: number[], b: number[]) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `hex` is #rrggbb or #rrggbbaa; the result is always an opaque #rrggbb. */
export function readable(hex: string, mode: Mode): string {
  const key = mode + hex;
  const hit = fixed.get(key);
  if (hit) return hit;
  const bg = channels(CODE_BG[mode]);
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  let rgb = channels(hex).map((v, i) => v * alpha + bg[i] * (1 - alpha));
  // Measure the rounded color, since that is what gets returned.
  const round = () => rgb.map((v) => Math.round(v));
  for (let i = 0; i < 200 && contrast(round(), bg) < MIN_CONTRAST[mode]; i++) {
    rgb = rgb.map((v) => (mode === 'light' ? v * 0.98 : v + (255 - v) * 0.02));
  }
  const out = '#' + round().map((v) => v.toString(16).padStart(2, '0')).join('');
  fixed.set(key, out);
  return out;
}

export function accessibleColors(html: string): string {
  return html.replace(
    /--shiki-(light|dark):(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)(?![0-9a-fA-F])/g,
    (_m, mode: Mode, hex: string) => `--shiki-${mode}:${readable(hex.toLowerCase(), mode)}`,
  );
}
