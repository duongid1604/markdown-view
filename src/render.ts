import MarkdownIt from 'markdown-it';
import type { Token, StateCore } from 'markdown-it';
import footnote from 'markdown-it-footnote';

/** Returns highlighted `<pre>` HTML, or null to fall back to plain code. */
export type Highlighter = (code: string, lang: string) => string | null;
/** Returns rendered math HTML, or null while the math library is still loading. */
export type MathRenderer = (tex: string, display: boolean) => string | null;
/** Returns a cache key for a diagram source; the SVG is attached after render. */
export type DiagramKey = (code: string) => string;

export interface RenderHooks {
  highlight?: Highlighter;
  math?: MathRenderer;
  diagram?: DiagramKey;
}

/** Prefix for heading ids, so ids never collide with page globals (DOM clobbering). */
export const HEADING_ID_PREFIX = 'h-';

const ALERT_ICONS: Record<string, string> = {
  note: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v3.6M8 5.2v.01"/>',
  tip: '<path d="M5.8 11.5h4.4M6.4 13.6h3.2M8 1.9a4.2 4.2 0 0 0-2.4 7.6c.4.3.6.7.6 1.2v.3h3.6v-.3c0-.5.2-.9.6-1.2A4.2 4.2 0 0 0 8 1.9z"/>',
  important: '<path d="M2.4 3.4c0-.6.5-1 1-1h9.2c.5 0 1 .4 1 1v6.8c0 .6-.5 1-1 1H7.2l-3 2.5v-2.5h-.8c-.5 0-1-.4-1-1z"/><path d="M8 4.8v2.8M8 9.4v.01"/>',
  warning: '<path d="M7.1 2.6 1.9 11.8c-.4.7.1 1.6.9 1.6h10.4c.8 0 1.3-.9.9-1.6L8.9 2.6a1 1 0 0 0-1.8 0z"/><path d="M8 6.2v3M8 11.1v.01"/>',
  caution: '<path d="M5.5 1.9h5l3.6 3.6v5l-3.6 3.6h-5l-3.6-3.6v-5z"/><path d="M8 5.2v3.4M8 10.6v.01"/>',
};
const ALERT_LABELS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

export function createRenderer({ highlight = () => null, math = () => null, diagram }: RenderHooks = {}) {
  const md = new MarkdownIt({
    html: true, // GitHub allows inline HTML; output is sanitized afterwards.
    linkify: true,
    typographer: false, // keep output faithful to how GitHub renders it
    breaks: false,
  });

  md.use(footnote);
  md.use(taskLists);
  md.use(alerts);
  md.use(headingIds);
  md.use(mathSyntax, math);
  md.use(sourceLines);
  md.use(fences, highlight, math, diagram);

  return (src: string): string => md.render(src);
}

/** Tag block tokens with their source line, for scroll sync and task toggling. */
function sourceLines(md: MarkdownIt) {
  md.core.ruler.push('source_lines', (state: StateCore) => {
    for (const t of state.tokens) {
      if (!t.map || t.hidden) continue;
      if (t.nesting === 1 || t.type === 'fence' || t.type === 'code_block' || t.type === 'hr' || t.type === 'math_block') {
        t.attrSet('data-line', String(t.map[0]));
      }
    }
  });
}

/** `- [ ] task` and `- [x] done`. Clicking a box toggles the source line. */
function taskLists(md: MarkdownIt) {
  md.core.ruler.before('inline', 'task_lists', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') {
        continue;
      }
      const m = /^\[([ xX])\](?=\s|$)\s*/.exec(inline.content);
      if (!m) continue;

      const checked = m[1] !== ' ';
      const li = tokens[i - 2];
      inline.content = inline.content.slice(m[0].length);
      li.attrJoin('class', checked ? 'task-list-item checked' : 'task-list-item');
      li.meta = { ...(li.meta ?? {}), task: checked };

      for (let j = i - 3; j >= 0; j--) {
        const list = tokens[j];
        if ((list.type === 'bullet_list_open' || list.type === 'ordered_list_open') && list.level === li.level - 1) {
          if (!(list.attrGet('class') ?? '').includes('contains-task-list')) list.attrJoin('class', 'contains-task-list');
          break;
        }
      }
    }
  });

  const base = md.renderer.rules.list_item_open;
  md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
    const out = base ? base(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    const t = tokens[idx];
    if (t.meta?.task === undefined) return out;
    const line = t.map ? t.map[0] : -1;
    return (
      out +
      `<input type="checkbox" class="task-checkbox" data-task-line="${line}"` +
      `${t.meta.task ? ' checked' : ''} aria-label="Toggle task">`
    );
  };
}

/** GitHub alerts: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`. */
function alerts(md: MarkdownIt) {
  md.core.ruler.before('inline', 'alerts', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i + 3 < tokens.length; i++) {
      const bq = tokens[i];
      if (bq.type !== 'blockquote_open' || tokens[i + 1].type !== 'paragraph_open' || tokens[i + 2].type !== 'inline') {
        continue;
      }
      const inline = tokens[i + 2];
      const m = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i.exec(inline.content);
      if (!m) continue;

      const kind = m[1].toLowerCase();
      inline.content = inline.content.slice(m[0].length);
      bq.attrJoin('class', `alert alert-${kind}`);
      bq.meta = { ...(bq.meta ?? {}), alert: kind };
      if (!inline.content.trim()) {
        tokens[i + 1].hidden = true;
        tokens[i + 3].hidden = true;
      }
    }
  });

  const base = md.renderer.rules.blockquote_open;
  md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    const out = base ? base(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    const kind: string | undefined = tokens[idx].meta?.alert;
    if (!kind) return out;
    return (
      out +
      `<p class="alert-title"><svg viewBox="0 0 16 16" aria-hidden="true">${ALERT_ICONS[kind]}</svg>${ALERT_LABELS[kind]}</p>\n`
    );
  };
}

/** GitHub-style heading ids with de-duplication, plus a hover `#` link. */
function headingIds(md: MarkdownIt) {
  md.core.ruler.push('heading_ids', (state: StateCore) => {
    const seen = new Map<string, number>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const text = (inline.children ?? [])
        .filter((c: Token) => c.type === 'text' || c.type === 'code_inline')
        .map((c: Token) => c.content)
        .join('');
      const base = slugify(text) || 'section';
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const slug = n ? `${base}-${n}` : base;
      t.attrSet('id', HEADING_ID_PREFIX + slug);
      t.meta = { ...(t.meta ?? {}), slug };
    }
  });

  md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
    const slug: string | undefined = tokens[idx].meta?.slug;
    const open = self.renderToken(tokens, idx, options);
    if (!slug) return open;
    return `${open}<a class="anchor" href="#${md.utils.escapeHtml(slug)}" aria-hidden="true" tabindex="-1">#</a>`;
  };
}

/** Code fences: wrapper with a language label; highlighted when possible. */
function fences(md: MarkdownIt, highlight: Highlighter, math: MathRenderer, diagram?: DiagramKey) {
  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const info = t.info ? md.utils.unescapeAll(t.info).trim() : '';
    const lang = info.split(/\s+/)[0] ?? '';
    const code = t.content;
    const lineAttr = t.attrGet('data-line') !== null ? ` data-line="${t.attrGet('data-line')}"` : '';

    if (lang.toLowerCase() === 'math') return renderMathBlock(md, math, code, lineAttr);
    if (lang.toLowerCase() === 'mermaid' && diagram) {
      // Filled with an SVG after render (see diagrams.ts); the source shows until then.
      return (
        `<div class="diagram" data-key="${diagram(code)}"${lineAttr}>` +
        `<pre class="diagram-src"><code>${md.utils.escapeHtml(code)}</code></pre></div>\n`
      );
    }
    const highlighted = lang ? highlight(code, lang.toLowerCase()) : null;
    const langClass = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : '';
    const body = highlighted ?? `<pre><code${langClass}>${md.utils.escapeHtml(code)}</code></pre>`;
    const line = t.attrGet('data-line');
    return (
      `<div class="code-block"${line !== null ? ` data-line="${line}"` : ''}>` +
      `<div class="code-head"><span class="code-lang">${md.utils.escapeHtml(lang)}</span></div>` +
      `${body}</div>\n`
    );
  };
}

/* Math ------------------------------------------------------------------ */

function renderMathBlock(md: MarkdownIt, math: MathRenderer, tex: string, lineAttr: string) {
  const html = math(tex.trim(), true);
  const body = html ?? `<pre class="math-src">${md.utils.escapeHtml(`$$\n${tex.trim()}\n$$`)}</pre>`;
  return `<div class="math-block${html ? '' : ' pending'}"${lineAttr}>${body}</div>\n`;
}

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || Number.isNaN(c);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isWordChar = (c: number) => /[\p{L}\p{N}]/u.test(String.fromCharCode(c));

/**
 * `$inline$` and `$$ display $$` math, with the usual guards so prices like
 * "$5 and $10" stay plain text: the opening `$` must not follow a letter or
 * digit nor precede a space; the closing `$` must not follow a space nor
 * precede a digit.
 */
function mathSyntax(md: MarkdownIt, math: MathRenderer) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
    if (src.charCodeAt(start + 1) === 0x24) return false;
    if (isSpace(src.charCodeAt(start + 1))) return false;
    if (start > 0 && isWordChar(src.charCodeAt(start - 1))) return false;

    let end = start + 1;
    for (;;) {
      end = src.indexOf('$', end);
      if (end === -1 || end >= state.posMax) return false;
      let backslashes = 0;
      for (let k = end - 1; src.charCodeAt(k) === 0x5c; k--) backslashes++;
      if (backslashes % 2 === 0) break;
      end++;
    }
    if (end === start + 1) return false;
    if (isSpace(src.charCodeAt(end - 1)) || isDigit(src.charCodeAt(end + 1))) return false;

    if (!silent) {
      const t = state.push('math_inline', 'math', 0);
      t.markup = '$';
      t.content = src.slice(start + 1, end);
    }
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.before(
    'fence',
    'math_block',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      if (state.src.slice(start, start + 2) !== '$$') return false;

      const first = state.src.slice(start + 2, max);
      let content: string | null = null;
      let last = startLine;

      if (first.trim().length >= 2 && first.trimEnd().endsWith('$$')) {
        content = first.trimEnd().slice(0, -2);
      } else {
        const lines = [first];
        for (let line = startLine + 1; line < endLine; line++) {
          const s = state.bMarks[line] + state.tShift[line];
          const e = state.eMarks[line];
          if (s < e && state.sCount[line] < state.blkIndent) break;
          const text = state.src.slice(s, e);
          if (text.trimEnd().endsWith('$$')) {
            lines.push(text.trimEnd().slice(0, -2));
            content = lines.join('\n');
            last = line;
            break;
          }
          lines.push(text);
        }
      }
      if (content === null) return false; // unclosed: leave it as text
      if (silent) return true;

      state.line = last + 1;
      const t = state.push('math_block', 'math', 0);
      t.block = true;
      t.content = content;
      t.markup = '$$';
      t.map = [startLine, state.line];
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );

  md.renderer.rules.math_inline = (tokens, idx) => {
    const tex = tokens[idx].content;
    const html = math(tex, false);
    return html
      ? `<span class="math-inline">${html}</span>`
      : `<span class="math-inline pending">${md.utils.escapeHtml(`$${tex}$`)}</span>`;
  };

  md.renderer.rules.math_block = (tokens, idx) => {
    const t = tokens[idx];
    const line = t.attrGet('data-line');
    return renderMathBlock(md, math, t.content, line !== null ? ` data-line="${line}"` : '');
  };
}
