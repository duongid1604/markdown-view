import type { Mermaid } from 'mermaid';

/**
 * Mermaid diagrams. The renderer emits `<div class="diagram" data-key>` with
 * the source inside; after each render we swap in an SVG. Mermaid (large) is
 * loaded only when a document has a diagram, renders run one at a time, and
 * while you type the previous SVG stays up until the new one is ready.
 */

type Theme = 'light' | 'dark';

const sources = new Map<string, string>();
const svgCache = new Map<string, string>();
const CACHE_LIMIT = 120;
let mermaidPromise: Promise<Mermaid> | null = null;
let configuredFor: Theme | null = null;
let latestTheme: Theme = 'light';
let timer = 0;
let running = false;
let rerun = false;
let seq = 0;

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

/** Used by the renderer: remembers the source and returns its key. */
export function diagramKey(code: string): string {
  const key = hash(code);
  sources.set(key, code);
  if (sources.size > CACHE_LIMIT * 2) sources.delete(sources.keys().next().value as string);
  return key;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function configure(mermaid: Mermaid, theme: Theme) {
  if (configuredFor === theme) return;
  configuredFor = theme;
  const v = {
    bg: cssVar('--bg-elev'),
    subtle: cssVar('--bg-subtle'),
    code: cssVar('--bg-code'),
    text: cssVar('--text'),
    text2: cssVar('--text-2'),
    muted: cssVar('--muted'),
    border: cssVar('--border'),
    strong: cssVar('--border-strong'),
    accent: cssVar('--accent'),
  };
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: cssVar('--font-sans'),
    themeVariables: {
      darkMode: theme === 'dark',
      fontSize: '14px',
      background: v.bg,
      primaryColor: v.subtle,
      primaryTextColor: v.text,
      primaryBorderColor: v.strong,
      secondaryColor: v.code,
      secondaryTextColor: v.text,
      secondaryBorderColor: v.strong,
      tertiaryColor: v.bg,
      tertiaryTextColor: v.text,
      tertiaryBorderColor: v.border,
      mainBkg: v.subtle,
      nodeBorder: v.strong,
      clusterBkg: v.code,
      clusterBorder: v.border,
      lineColor: v.muted,
      textColor: v.text,
      titleColor: v.text,
      edgeLabelBackground: v.bg,
      actorBkg: v.subtle,
      actorBorder: v.strong,
      actorTextColor: v.text,
      actorLineColor: v.strong,
      signalColor: v.muted,
      signalTextColor: v.text,
      labelBoxBkgColor: v.subtle,
      labelBoxBorderColor: v.strong,
      labelTextColor: v.text,
      loopTextColor: v.text2,
      noteBkgColor: v.code,
      noteBorderColor: v.strong,
      noteTextColor: v.text2,
      activationBkgColor: v.code,
      activationBorderColor: v.strong,
      sequenceNumberColor: v.bg,
      pie1: v.accent,
    },
    flowchart: { curve: 'basis', padding: 14 },
  });
}

function apply(block: HTMLElement, html: string, renderedKey: string) {
  block.innerHTML = html;
  block.dataset.rendered = renderedKey;
}

/* Mermaid is large: wait until a diagram is close to the visible part of the
   preview before loading it and drawing. */
const nearView = new WeakSet<Element>();
let observer: IntersectionObserver | null = null;
let observedRoot: HTMLElement | null = null;

function watch(root: HTMLElement) {
  if (!('IntersectionObserver' in window)) return;
  if (!observer || observedRoot !== root) {
    observedRoot = root;
    observer = new IntersectionObserver(
      (entries) => {
        let woke = false;
        for (const e of entries) {
          if (e.isIntersecting && !nearView.has(e.target)) {
            nearView.add(e.target);
            woke = true;
          }
        }
        if (woke) hydrateDiagrams(root, latestTheme);
      },
      { root: root.closest('.preview-scroll'), rootMargin: '800px 0px' },
    );
  }
  for (const b of root.querySelectorAll('.diagram')) observer.observe(b);
}

function isNear(block: Element) {
  return !('IntersectionObserver' in window) || nearView.has(block);
}

function needsWork(root: HTMLElement, theme: Theme) {
  return [...root.querySelectorAll<HTMLElement>('.diagram')].filter(
    (b) => b.dataset.rendered !== `${b.dataset.key}|${theme}` && isNear(b),
  );
}

async function renderPending(root: HTMLElement, theme: Theme) {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    mermaidPromise ??= import('mermaid').then((m) => m.default);
    const mermaid = await mermaidPromise;
    configure(mermaid, theme);

    for (const block of needsWork(root, theme)) {
      const key = block.dataset.key!;
      const ck = `${key}|${theme}`;
      let html = svgCache.get(ck);
      if (html === undefined) {
        const code = sources.get(key);
        if (code === undefined) continue;
        const id = `folio-diagram-${++seq}`;
        try {
          const { svg } = await mermaid.render(id, code);
          html = svg;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          html =
            `<div class="diagram-error">${escapeHtml(message.trim().slice(0, 400) || 'This diagram could not be drawn.')}</div>` +
            `<pre class="diagram-src"><code>${escapeHtml(code)}</code></pre>`;
          document.getElementById(`d${id}`)?.remove(); // Mermaid's scratch node after a failed render
        }
        svgCache.set(ck, html);
        if (svgCache.size > CACHE_LIMIT) svgCache.delete(svgCache.keys().next().value as string);
      }
      // The block may have been replaced while we were rendering.
      for (const b of root.querySelectorAll<HTMLElement>(`.diagram[data-key="${key}"]`)) apply(b, html, ck);
    }
  } catch (err) {
    console.warn('[diagrams] could not load Mermaid', err);
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      void renderPending(root, latestTheme);
    }
  }
}

/** Call after every render and on theme change. */
export function hydrateDiagrams(root: HTMLElement, theme: Theme) {
  latestTheme = theme;
  watch(root);
  const todo = needsWork(root, theme);
  if (!todo.length) return;

  let missing = false;
  for (const block of todo) {
    const ck = `${block.dataset.key}|${theme}`;
    const cached = svgCache.get(ck);
    if (cached !== undefined) apply(block, cached, ck);
    else missing = true;
  }
  if (!missing) return;

  // Wait for a pause in typing before drawing new diagrams.
  clearTimeout(timer);
  const delay = mermaidPromise ? 280 : 0;
  timer = window.setTimeout(() => void renderPending(root, theme), delay);
}

/** Draw every diagram now, visible or not (before exporting or printing). */
export async function drawAllDiagrams(root: HTMLElement, theme: Theme) {
  latestTheme = theme;
  const blocks = root.querySelectorAll('.diagram');
  if (!blocks.length) return;
  blocks.forEach((b) => nearView.add(b));
  clearTimeout(timer);
  await renderPending(root, theme);
  for (let i = 0; running && i < 200; i++) await new Promise((r) => setTimeout(r, 50));
}
