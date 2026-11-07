import { defineConfig, type Plugin } from 'vitest/config';
import type { OutputChunk } from 'rollup';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRenderer } from './src/render';
import { diagramKey } from './src/diagrams';
import { describe as describeText } from './src/stats';
import { SAMPLE_TITLE } from './src/config';

/**
 * Emits `sw.js` with a precache list built from the real bundle: the page,
 * the entry script and its static imports, the entry CSS, the two UI fonts
 * (Latin) and the icons. Everything else (highlighting grammars, KaTeX,
 * Mermaid) is cached the first time it is used.
 */
function serviceWorker(): Plugin {
  return {
    name: 'folio-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle);
      const entry = Object.values(bundle).find((f): f is OutputChunk => f.type === 'chunk' && f.isEntry);
      const precache = new Set<string>(['./', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png']);
      if (entry) {
        precache.add(entry.fileName);
        entry.imports.forEach((f) => precache.add(f));
        entry.viteMetadata?.importedCss.forEach((f) => precache.add(f));
      }
      files.filter((f) => /(inter|jetbrains-mono)-latin-wght-normal.*\.woff2$/.test(f)).forEach((f) => precache.add(f));

      const version = createHash('sha256').update(files.sort().join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify([...precache], null, 2)),
      });
    },
  };
}

/** With SITE_URL set at build time (e.g. https://you.github.io/folio), social previews get absolute URLs. */
function absoluteSocialUrls(): Plugin {
  return {
    name: 'folio-site-url',
    transformIndexHtml(html) {
      const site = process.env.SITE_URL?.replace(/\/+$/, '');
      if (!site) return html;
      return html
        .replace('content="./og-image.png"', `content="${site}/og-image.png"`)
        .replace('<meta property="og:type"', `<meta property="og:url" content="${site}/" />\n    <meta property="og:type"`);
    },
  };
}

/**
 * Bakes the welcome document into index.html so first-time visitors see it
 * before any JavaScript runs. It renders exactly what the app renders before
 * its lazy libraries arrive, so the app takes over without a visible change.
 */
function prerenderSample(): Plugin {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    name: 'folio-prerender',
    apply: 'build',
    transformIndexHtml(html) {
      const sample = readFileSync(new URL('./src/sample.md', import.meta.url), 'utf8');
      const body = createRenderer({ diagram: diagramKey })(sample);
      const stats = describeText(sample);
      const swap = (from: string, to: string) => {
        if (!html.includes(from)) throw new Error(`prerender: "${from}" not found in index.html`);
        html = html.replace(from, to);
      };
      swap('<article id="preview" class="prose"></article>', `<article id="preview" class="prose">${body}</article>`);
      swap(
        '<div id="editor" class="editor-host"></div>',
        `<div id="editor" class="editor-host"><pre class="editor-prerender" aria-hidden="true">${escape(sample)}</pre></div>`,
      );
      swap('value="Untitled"', `value="${SAMPLE_TITLE}"`);
      swap('<span id="stat-words">0 words</span>', `<span id="stat-words">${stats.words}</span>`);
      swap('<span id="stat-chars" class="hide-sm">0 characters</span>', `<span id="stat-chars" class="hide-sm">${stats.chars}</span>`);
      swap('<span id="stat-read">&lt; 1 min read</span>', `<span id="stat-read">${escape(stats.read)}</span>`);
      return html;
    },
  };
}

export default defineConfig({
  // Relative asset paths: the build works from any sub-path
  // (GitHub Pages project sites, Cloudflare Pages, Netlify, a custom domain).
  base: './',
  plugins: [prerenderSample(), serviceWorker(), absoluteSocialUrls()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es', // the highlighting worker loads grammars on demand (code splitting)
  },
  test: {
    environment: 'jsdom',
  },
});
