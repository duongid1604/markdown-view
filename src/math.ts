import type katexType from 'katex';
import { whenIdle } from './idle';

/**
 * KaTeX, loaded the first time a document contains math. Until it arrives,
 * math shows as its source, and `onReady` asks the app to render again.
 */

let katex: typeof katexType | null = null;
let loading = false;
let onReady: () => void = () => {};
const cache = new Map<string, string>();
const CACHE_LIMIT = 500;

export function onMathReady(fn: () => void) {
  onReady = fn;
}

function load() {
  if (loading) return;
  loading = true;
  whenIdle(() => {
    Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([mod]) => {
        katex = mod.default;
        onReady();
      })
      .catch((err) => {
        loading = false;
        console.warn('[math] could not load KaTeX', err);
      });
  });
}

export function renderMath(tex: string, display: boolean): string | null {
  if (!katex) {
    load();
    return null;
  }
  const key = `${display ? 'D' : 'I'}${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false, // show the error in place instead of breaking the page
    output: 'htmlAndMathml',
    strict: 'ignore',
    trust: false,
  });
  cache.set(key, html);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return html;
}

/** The loaded KaTeX version, for linking its stylesheet from exported files. */
export function katexVersion(): string | null {
  return katex?.version ?? null;
}
