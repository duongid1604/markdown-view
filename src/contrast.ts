/* Vitesse's softest light-theme colors fall below WCAG AA (4.5:1) on our code
   background. Nudge each token color toward black (light) or white (dark)
   just far enough to pass, keeping its hue. */
const CODE_BG = { light: '#f7f7f5', dark: '#161618' };
const MIN_CONTRAST = 4.6;
const fixed = new Map<string, string>();

function luminance(hex: string) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function readable(hex: string, mode: 'light' | 'dark'): string {
  const key = mode + hex;
  const hit = fixed.get(key);
  if (hit) return hit;
  const bg = CODE_BG[mode];
  let rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = () => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < 200 && contrast(toHex(), bg) < MIN_CONTRAST; i++) {
    rgb = rgb.map((v) => (mode === 'light' ? v * 0.98 : v + (255 - v) * 0.02));
  }
  const out = toHex();
  fixed.set(key, out);
  return out;
}
export function accessibleColors(html: string): string {
  return html.replace(/--shiki-(light|dark):(#[0-9a-fA-F]{6})\b/g, (_m, mode: 'light' | 'dark', hex: string) => `--shiki-${mode}:${readable(hex.toLowerCase(), mode)}`);
}
