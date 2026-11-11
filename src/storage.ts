const PREFIX = 'folio:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Returns false when storage is unavailable or full. */
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export type Theme = 'system' | 'light' | 'dark';
export type View = 'write' | 'split' | 'preview';
/** Preview page width: null = default (70ch), a px width, or 'full' (fill the pane). */
export type PageWidth = number | 'full' | null;

export const pageWidthCss = (w: PageWidth) => (w === null ? '70ch' : w === 'full' ? '100%' : `${Math.round(w)}px`);

export interface Settings {
  theme: Theme;
  view: View;
  split: number; // editor share of the width, 0.2–0.8
  sync: boolean;
  serif: boolean;
  focus: boolean;
  outline: boolean;
  width: PageWidth;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  view: 'split',
  split: 0.5,
  sync: true,
  serif: false,
  focus: false,
  outline: true,
  width: null,
};

export function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) };
  if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = 'system';
  if (!['write', 'split', 'preview'].includes(s.view)) s.view = 'split';
  if (s.width !== 'full' && !(typeof s.width === 'number' && s.width >= 200 && s.width <= 20000)) s.width = null;
  if (typeof s.split !== 'number' || !(s.split >= 0.2 && s.split <= 0.8)) s.split = 0.5;
  return s;
}
