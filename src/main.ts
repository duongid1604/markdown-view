import morphdom from 'morphdom';
import type { EditorView } from '@codemirror/view';
import { createEditor, replaceDoc, setFocusMode, insertBlock, insertFootnote, insertLink, goToLine } from './editor';
import { createRenderer, HEADING_ID_PREFIX } from './render';
import { sanitizeToFragment } from './sanitize';
import { highlight, onHighlighterReady } from './highlight';
import { renderMath, onMathReady, katexVersion } from './math';
import { diagramKey, hydrateDiagrams, drawAllDiagrams } from './diagrams';
import { ScrollSync } from './scroll-sync';
import { load, save, loadSettings, pageWidthCss, type View, type Theme, type PageWidth } from './storage';
import { describe } from './stats';
import { buildShareUrl, readShareHash, clearShareHash } from './share';
import { buildStandaloneHtml, cleanPreviewHtml, copyText, download, fileNameFor } from './export';
import { toast } from './ui/toast';
import { setupMenu } from './ui/menu';
import { Outline, type Heading } from './ui/outline';
import { createPalette, type Command } from './ui/palette';
import SAMPLE from './sample.md?raw';
import { SAMPLE_TITLE } from './config';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const root = document.documentElement;
const previewEl = $('#preview');
const previewScroll = $('#preview-scroll');
const titleInput = $<HTMLInputElement>('#doc-title');
const themeBtn = $('#theme-btn');
const menuBtn = $('#menu-btn');
const menuEl = $('#menu');
const splitter = $('#splitter');
const workspace = $('#workspace');
const fileInput = $<HTMLInputElement>('#file-input');
const dropEl = $('#drop');
const statWords = $('#stat-words');
const statChars = $('#stat-chars');
const statRead = $('#stat-read');
const statCursor = $('#stat-cursor');
const statSaved = $('#stat-saved');

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const isNarrow = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const settings = loadSettings();
const persistSettings = () => save('settings', settings);

/* Initial document ----------------------------------------------------- */

const savedDoc = load<string | null>('doc', null);
const savedTitle = load<string>('title', 'Untitled');
const shared = readShareHash();

let doc = shared?.doc ?? savedDoc ?? SAMPLE;
let title = shared?.title ?? (savedDoc === null ? SAMPLE_TITLE : savedTitle);

/* Rendering ------------------------------------------------------------ */

const render = createRenderer({ highlight, math: renderMath, diagram: diagramKey });
let lastRenderMs = 0;
let renderTimer = 0;
let renderPending = false;

function addCopyButtons() {
  for (const head of previewEl.querySelectorAll('.code-head')) {
    if (head.querySelector('.code-copy')) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    head.append(btn);
  }
}

function renderNow() {
  clearTimeout(renderTimer);
  renderPending = false;
  const t0 = performance.now();

  const next = document.createElement('article');
  next.append(sanitizeToFragment(render(doc)));
  morphdom(previewEl, next, {
    childrenOnly: true,
    onBeforeElUpdated: (from, to) => {
      // Diagrams keep their drawn SVG; only their key and line change here.
      if (from.classList.contains('diagram') && to.classList.contains('diagram')) {
        from.dataset.key = to.dataset.key;
        if (to.dataset.line !== undefined) from.dataset.line = to.dataset.line;
        return false;
      }
      return !from.isEqualNode(to);
    },
    onBeforeNodeDiscarded: (node) => !(node instanceof HTMLElement && node.classList.contains('code-copy')),
  });
  addCopyButtons();
  hydrateDiagrams(previewEl, effectiveTheme());
  outline.refresh();

  const s = describe(doc);
  statWords.textContent = s.words;
  statChars.textContent = s.chars;
  statRead.textContent = s.read;

  lastRenderMs = performance.now() - t0;
  if (syncActive()) sync.syncFromEditor();
  else sync.invalidate();
}

/** Renders on the next frame; backs off a little when documents get large. */
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  const delay = lastRenderMs < 12 ? 0 : Math.min(240, lastRenderMs * 2);
  renderTimer = window.setTimeout(() => requestAnimationFrame(renderNow), delay);
}

function forceRender() {
  renderPending = false;
  scheduleRender();
}
onHighlighterReady(forceRender);
onMathReady(forceRender);

/* Autosave ------------------------------------------------------------- */

let saveTimer = 0;

function persist() {
  clearTimeout(saveTimer);
  const ok = save('doc', doc) && save('title', title);
  statSaved.dataset.state = ok ? 'saved' : 'error';
  statSaved.textContent = ok ? 'Saved' : 'Not saved — storage unavailable';
}

function markDirty() {
  statSaved.dataset.state = 'dirty';
  statSaved.textContent = 'Editing';
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 450);
}

window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist());

/* Editor --------------------------------------------------------------- */

$('#editor').replaceChildren(); // drop the static copy baked in at build time
const view: EditorView = createEditor({
  parent: $('#editor'),
  doc,
  onChange(next) {
    doc = next;
    scheduleRender();
    markDirty();
  },
  onCursor(line, col) {
    statCursor.textContent = `Ln ${line}, Col ${col}`;
  },
});

const sync = new ScrollSync(view, previewScroll, previewEl);
sync.enabled = settings.sync;

function syncActive() {
  return settings.sync && effectiveView() === 'split';
}

/* Outline -------------------------------------------------------------- */

let jumpTimer = 0;
function jumpToHeading(h: Heading) {
  // Move both panes ourselves; pause scroll sync so it does not fight the smooth scroll.
  sync.enabled = false;
  clearTimeout(jumpTimer);
  if (effectiveView() !== 'preview') goToLine(view, h.line);
  h.el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  jumpTimer = window.setTimeout(() => (sync.enabled = settings.sync), 900);
}

const outline = new Outline($('#toc'), previewScroll, previewEl, jumpToHeading);
outline.enabled = settings.outline;

/* Title ---------------------------------------------------------------- */

function setTitle(next: string) {
  title = next;
  titleInput.value = next;
  document.title = next || 'Untitled';
}

titleInput.addEventListener('input', () => {
  title = titleInput.value;
  document.title = title || 'Untitled';
  markDirty();
});
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault();
    view.focus();
  }
});
titleInput.addEventListener('blur', () => {
  if (!titleInput.value.trim()) {
    setTitle('Untitled');
    markDirty();
  }
});
titleInput.addEventListener('focus', () => titleInput.select());

/** Swap in a whole new document; the toast offers a one-click way back. */
function replaceDocument(nextDoc: string, nextTitle: string, message: string) {
  const prev = { doc, title };
  replaceDoc(view, nextDoc);
  setTitle(nextTitle);
  previewScroll.scrollTop = 0;
  persist();
  toast(message, {
    action: {
      label: 'Undo',
      run: () => {
        replaceDoc(view, prev.doc);
        setTitle(prev.title);
        persist();
      },
    },
  });
}

/* Views ---------------------------------------------------------------- */

function effectiveView(): View {
  return isNarrow.matches && settings.view === 'split' ? 'write' : settings.view;
}

function applyView() {
  root.dataset.view = settings.view;
  const current = effectiveView();
  for (const btn of document.querySelectorAll<HTMLElement>('[data-view-btn]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.viewBtn === current));
  }
  requestAnimationFrame(() => {
    view.requestMeasure();
    outline.refresh();
    if (syncActive()) requestAnimationFrame(() => sync.syncFromEditor());
  });
}

function setView(next: View) {
  if (isNarrow.matches && next === 'split') next = 'write';
  settings.view = next;
  persistSettings();
  applyView();
  if (next === 'write') view.focus();
}

for (const btn of document.querySelectorAll<HTMLElement>('[data-view-btn]')) {
  btn.addEventListener('click', () => setView(btn.dataset.viewBtn as View));
}
isNarrow.addEventListener('change', applyView);

/* Theme ---------------------------------------------------------------- */

function effectiveTheme(): 'light' | 'dark' {
  if (settings.theme === 'system') return prefersDark.matches ? 'dark' : 'light';
  return settings.theme;
}

function applyTheme(animate: boolean) {
  if (animate && !reducedMotion.matches) {
    root.classList.add('theme-anim');
    setTimeout(() => root.classList.remove('theme-anim'), 320);
  }
  if (settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;

  const mode = effectiveTheme();
  const nextLabel = mode === 'dark' ? 'Switch to light' : 'Switch to dark';
  themeBtn.dataset.mode = mode;
  themeBtn.dataset.tip = nextLabel;
  themeBtn.setAttribute('aria-label', nextLabel);
  menuEl.querySelector('[data-action="toggle-system"]')?.setAttribute('aria-checked', String(settings.theme === 'system'));
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (settings.theme !== 'system') meta.content = mode === 'dark' ? '#1B1B1D' : '#FCFCFB';
  }
  hydrateDiagrams(previewEl, mode); // diagrams are drawn per theme
}

function setTheme(theme: Theme) {
  settings.theme = theme;
  persistSettings();
  applyTheme(true);
}

themeBtn.addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
prefersDark.addEventListener('change', () => applyTheme(true));

/* Splitter ------------------------------------------------------------- */

function setSplit(ratio: number) {
  settings.split = Math.min(0.8, Math.max(0.2, ratio));
  root.style.setProperty('--split', `${settings.split * 100}%`);
  splitter.setAttribute('aria-valuenow', String(Math.round(settings.split * 100)));
}

splitter.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  splitter.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const rect = workspace.getBoundingClientRect();
  const move = (ev: PointerEvent) => setSplit((ev.clientX - rect.left) / rect.width);
  const end = () => {
    splitter.removeEventListener('pointermove', move);
    document.body.classList.remove('resizing');
    persistSettings();
    sync.syncFromEditor();
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', end, { once: true });
  splitter.addEventListener('pointercancel', end, { once: true });
});
splitter.addEventListener('dblclick', () => {
  setSplit(0.5);
  persistSettings();
});
splitter.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.1 : 0.02;
  if (e.key === 'ArrowLeft') setSplit(settings.split - step);
  else if (e.key === 'ArrowRight') setSplit(settings.split + step);
  else return;
  e.preventDefault();
  persistSettings();
});

/* Page width handles --------------------------------------------------- */

const panePreview = $('.pane-preview');
const pageHandles = Array.from(document.querySelectorAll<HTMLElement>('.page-handle'));
const HANDLE_GAP = 14; // px between the text edge and the handle, so it never sits on the text
const MIN_TEXT = 280; // narrowest text column, px

/** Padding on both sides of the page; the stored width includes it (border-box). */
function pagePadding() {
  const cs = getComputedStyle(previewEl);
  return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
}

function placePageHandles() {
  const pane = panePreview.getBoundingClientRect();
  const r = previewEl.getBoundingClientRect();
  if (!r.width) return;
  const cs = getComputedStyle(previewEl);
  const left = r.left - pane.left + parseFloat(cs.paddingLeft) - HANDLE_GAP;
  const right = r.right - pane.left - parseFloat(cs.paddingRight) + HANDLE_GAP;
  for (const h of pageHandles) h.style.left = `${h.dataset.side === 'left' ? left : right}px`;
}

function setPageWidth(width: PageWidth) {
  settings.width = width;
  root.style.setProperty('--prose-width', pageWidthCss(width));
  placePageHandles();
}

/** Apply a dragged width in px: snaps to 'full' once it reaches the pane. */
function dragPageWidth(px: number) {
  const max = previewScroll.clientWidth;
  setPageWidth(px >= max - 1 ? 'full' : Math.max(MIN_TEXT + pagePadding(), px));
}

function pageWidthChanged() {
  persistSettings();
  sync.invalidate();
  outline.refresh();
}

for (const handle of pageHandles) {
  const dir = handle.dataset.side === 'left' ? -1 : 1; // moving outward makes the page wider
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-page');
    handle.classList.add('dragging');
    const startX = e.clientX;
    const startWidth = previewEl.getBoundingClientRect().width;
    // The page is centred, so each side moves by half the change.
    const move = (ev: PointerEvent) => dragPageWidth(startWidth + 2 * dir * (ev.clientX - startX));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', end);
      document.body.classList.remove('resizing-page');
      handle.classList.remove('dragging');
      pageWidthChanged();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end); // fires after pointerup/cancel, even off-window
  });
  handle.addEventListener('dblclick', () => {
    setPageWidth(null);
    pageWidthChanged();
  });
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 64 : 16;
    const delta = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    if (!delta) return;
    e.preventDefault();
    dragPageWidth(previewEl.getBoundingClientRect().width + 2 * dir * delta);
    pageWidthChanged();
  });
}

/* Show a grip only when the pointer comes near its edge, at the pointer's height. */
const NEAR = 48; // px from the handle
let nearFrame = 0;
let lastPointer: { x: number; y: number } | null = null;

function updateNearHandles() {
  nearFrame = 0;
  const pane = panePreview.getBoundingClientRect();
  for (const h of pageHandles) {
    const x = pane.left + parseFloat(h.style.left || '-1000');
    h.classList.toggle('near', !!lastPointer && Math.abs(lastPointer.x - x) <= NEAR);
  }
  if (lastPointer) {
    const y = Math.min(pane.height - 40, Math.max(40, lastPointer.y - pane.top));
    panePreview.style.setProperty('--grip-y', `${y}px`);
  }
}

panePreview.addEventListener(
  'pointermove',
  (e) => {
    if (e.pointerType === 'touch') return;
    lastPointer = { x: e.clientX, y: e.clientY };
    if (!nearFrame) nearFrame = requestAnimationFrame(updateNearHandles);
  },
  { passive: true },
);
panePreview.addEventListener('pointerleave', () => {
  lastPointer = null;
  if (!nearFrame) nearFrame = requestAnimationFrame(updateNearHandles);
});

new ResizeObserver(placePageHandles).observe(previewEl);
new ResizeObserver(placePageHandles).observe(panePreview);

/* Preview interactions ------------------------------------------------- */

function toggleTask(line0: number) {
  if (!(line0 >= 0) || line0 >= view.state.doc.lines) return;
  const line = view.state.doc.line(line0 + 1);
  const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(line.text);
  if (!m) return;
  const from = line.from + m[1].length;
  view.dispatch({ changes: { from, to: from + 1, insert: m[2] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
}

function scrollToAnchor(id: string) {
  const el = document.getElementById(HEADING_ID_PREFIX + id) ?? document.getElementById(id);
  if (!el || !previewEl.contains(el)) return;
  el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
}

previewEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const copyBtn = target.closest<HTMLElement>('.code-copy');
  if (copyBtn) {
    const code = copyBtn.closest('.code-block')?.querySelector('pre')?.textContent ?? '';
    void copyText(code).then((ok) => {
      copyBtn.textContent = ok ? 'Copied' : 'Failed';
      copyBtn.dataset.copied = '';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        delete copyBtn.dataset.copied;
      }, 1400);
    });
    return;
  }

  const box = target.closest<HTMLInputElement>('input.task-checkbox');
  if (box) {
    e.preventDefault();
    toggleTask(Number(box.dataset.taskLine));
    return;
  }

  const link = target.closest('a');
  const href = link?.getAttribute('href');
  if (href?.startsWith('#')) {
    e.preventDefault();
    scrollToAnchor(decodeURIComponent(href.slice(1)));
  }
});

/* Files ---------------------------------------------------------------- */

async function openFile(file: File) {
  const looksText = /\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(file.name) || file.type.startsWith('text/');
  if (!looksText) return toast('Only Markdown or plain-text files can be opened');
  if (file.size > MAX_FILE_BYTES) return toast('That file is larger than 5 MB');
  const text = (await file.text()).replace(/\r\n?/g, '\n');
  replaceDocument(text, file.name.replace(/\.[^.]+$/, '') || 'Untitled', `Opened ${file.name}`);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
  fileInput.value = '';
});

let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

window.addEventListener(
  'dragenter',
  (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropEl.hidden = false;
  },
  true,
);
window.addEventListener(
  'dragover',
  (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'copy';
  },
  true,
);
window.addEventListener(
  'dragleave',
  (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropEl.hidden = true;
  },
  true,
);
window.addEventListener(
  'drop',
  (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation(); // keep CodeMirror from inserting the file as text
    dragDepth = 0;
    dropEl.hidden = true;
    const file = e.dataTransfer!.files[0];
    if (file) void openFile(file);
  },
  true,
);

/* Actions -------------------------------------------------------------- */

function setChecked(action: string, on: boolean) {
  menuEl.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-checked', String(on));
}

function applyFocus() {
  setFocusMode(view, settings.focus);
  setChecked('toggle-focus', settings.focus);
}

async function runAction(action: string) {
  switch (action) {
    case 'palette':
      palette.open();
      break;
    case 'new':
      replaceDocument('', 'Untitled', 'New document');
      view.focus();
      break;
    case 'open':
      fileInput.click();
      break;
    case 'sample':
      replaceDocument(SAMPLE, SAMPLE_TITLE, 'Example loaded');
      break;
    case 'download-md':
      download(fileNameFor(title, 'md'), doc, 'text/markdown;charset=utf-8');
      break;
    case 'download-html':
      renderNow();
      await drawAllDiagrams(previewEl, effectiveTheme());
      download(
        fileNameFor(title, 'html'),
        buildStandaloneHtml(title, previewEl, settings.serif, katexVersion(), pageWidthCss(settings.width)),
        'text/html;charset=utf-8',
      );
      break;
    case 'copy-html':
      renderNow();
      await drawAllDiagrams(previewEl, effectiveTheme());
      toast((await copyText(cleanPreviewHtml(previewEl))) ? 'HTML copied' : 'Could not copy to the clipboard');
      break;
    case 'share': {
      const url = buildShareUrl(title, doc);
      const ok = await copyText(url);
      if (!ok) toast('Could not copy the link');
      else if (url.length > 8000) toast('Link copied — it is long, so some apps may cut it off');
      else toast('Share link copied');
      break;
    }
    case 'print':
      renderNow();
      await drawAllDiagrams(previewEl, effectiveTheme());
      window.print();
      break;
    case 'toggle-sync':
      settings.sync = !settings.sync;
      sync.enabled = settings.sync;
      setChecked('toggle-sync', settings.sync);
      persistSettings();
      if (syncActive()) sync.syncFromEditor();
      break;
    case 'toggle-serif':
      settings.serif = !settings.serif;
      previewEl.classList.toggle('serif', settings.serif);
      setChecked('toggle-serif', settings.serif);
      persistSettings();
      sync.invalidate();
      break;
    case 'toggle-focus':
      settings.focus = !settings.focus;
      persistSettings();
      applyFocus();
      toast(settings.focus ? 'Focus mode on' : 'Focus mode off');
      break;
    case 'toggle-outline':
      settings.outline = !settings.outline;
      outline.enabled = settings.outline;
      setChecked('toggle-outline', settings.outline);
      persistSettings();
      outline.refresh();
      break;
    case 'toggle-system':
      setTheme(settings.theme === 'system' ? effectiveTheme() : 'system');
      break;
  }
}

setupMenu(menuBtn, menuEl, (action) => void runAction(action));

/* Command menu --------------------------------------------------------- */

const key = (s: string) => (isMac ? s : s.replace(/⌥⌘/g, 'Ctrl+Alt+').replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+'));
const onOff = (on: boolean) => (on ? 'On' : 'Off');

/** Run an editor command after the palette closes and focus is back in the editor. */
function inEditor(fn: () => void) {
  return () => {
    if (effectiveView() === 'preview') setView(isNarrow.matches ? 'write' : 'split');
    view.focus();
    fn();
  };
}

const SNIPPETS: Array<[string, string, string]> = [
  ['Table', 'grid columns rows', '| Column | Column |\n| ------ | ------ |\n| ¦      |        |\n'],
  ['Code block', 'fence snippet', '```¦\n\n```\n'],
  ['Math block', 'katex latex equation formula', '$$\n¦\n$$\n'],
  ['Diagram', 'mermaid flowchart chart graph', '```mermaid\nflowchart LR\n  A[Idea] --> B[Draft] --> C[Edit]¦\n```\n'],
  ['Callout', 'alert note tip warning admonition', '> [!NOTE]\n> ¦\n'],
  ['Task list', 'todo checkbox checklist', '- [ ] ¦\n'],
  ['Divider', 'horizontal rule hr line', '---\n¦'],
];

function commands(): Command[] {
  const list: Command[] = [
    { id: 'new', group: 'Document', title: 'New document', keywords: 'blank clear', run: () => void runAction('new') },
    { id: 'open', group: 'Document', title: 'Open file…', hint: key('⌘O'), keywords: 'import load', run: () => void runAction('open') },
    { id: 'sample', group: 'Document', title: 'Show example', keywords: 'sample demo welcome', run: () => void runAction('sample') },
    { id: 'dl-md', group: 'Document', title: 'Download Markdown', hint: key('⌘S'), keywords: 'save export .md', run: () => void runAction('download-md') },
    { id: 'dl-html', group: 'Document', title: 'Download HTML', keywords: 'export save .html', run: () => void runAction('download-html') },
    { id: 'copy-html', group: 'Document', title: 'Copy HTML', keywords: 'clipboard', run: () => void runAction('copy-html') },
    { id: 'share', group: 'Document', title: 'Copy share link', keywords: 'url link send', run: () => void runAction('share') },
    { id: 'print', group: 'Document', title: 'Print or save as PDF', hint: key('⌘P'), keywords: 'pdf', run: () => void runAction('print') },

    { id: 'v-write', group: 'View', title: 'Write', hint: key('⌥⌘1'), keywords: 'editor only', run: () => setView('write') },
    ...(isNarrow.matches
      ? []
      : [{ id: 'v-split', group: 'View', title: 'Split', hint: key('⌥⌘2'), keywords: 'side by side', run: () => setView('split') }]),
    { id: 'v-preview', group: 'View', title: 'Preview', hint: key('⌥⌘3'), keywords: 'read only', run: () => setView('preview') },
    { id: 'focus', group: 'View', title: 'Focus mode', hint: onOff(settings.focus), keywords: 'zen dim distraction', run: () => void runAction('toggle-focus') },
    { id: 'outline', group: 'View', title: 'Outline', hint: onOff(settings.outline), keywords: 'toc table of contents headings', run: () => void runAction('toggle-outline') },
    { id: 'sync', group: 'View', title: 'Sync scroll', hint: onOff(settings.sync), run: () => void runAction('toggle-sync') },
    { id: 'serif', group: 'View', title: 'Serif preview', hint: onOff(settings.serif), keywords: 'font typeface', run: () => void runAction('toggle-serif') },
    { id: 'width-reset', group: 'View', title: 'Reset page width', keywords: 'column measure size wide narrow full layout', run: () => { setPageWidth(null); persistSettings(); } },
    { id: 't-light', group: 'View', title: 'Light theme', keywords: 'appearance color', run: () => setTheme('light') },
    { id: 't-dark', group: 'View', title: 'Dark theme', keywords: 'appearance color night', run: () => setTheme('dark') },
    { id: 't-system', group: 'View', title: 'Match system theme', keywords: 'appearance auto', run: () => setTheme('system') },

    ...SNIPPETS.map(([name, keywords, snippet]) => ({
      id: `ins-${name}`,
      group: 'Insert',
      title: name,
      keywords,
      run: inEditor(() => insertBlock(view, snippet)),
    })),
    { id: 'ins-link', group: 'Insert', title: 'Link', hint: key('⇧⌘K'), keywords: 'url href', run: inEditor(() => insertLink(view)) },
    { id: 'ins-footnote', group: 'Insert', title: 'Footnote', keywords: 'note reference', run: inEditor(() => insertFootnote(view)) },
  ];

  for (const h of outline.items) {
    list.push({
      id: `h-${h.id}`,
      group: 'Headings',
      title: h.text,
      hint: `H${h.el.tagName[1]}`,
      keywords: 'heading section jump go to',
      run: () => jumpToHeading(h),
    });
  }
  return list;
}

const palette = createPalette(commands);

/* Keyboard shortcuts --------------------------------------------------- */

window.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (!e.altKey && !e.shiftKey && k === 'k') {
    e.preventDefault();
    palette.toggle();
  } else if (e.altKey && /^Digit[123]$/.test(e.code)) {
    e.preventDefault();
    setView((['write', 'split', 'preview'] as const)[Number(e.code.slice(5)) - 1]);
  } else if (e.altKey && e.code === 'KeyF') {
    e.preventDefault();
    void runAction('toggle-focus');
  } else if (!e.altKey && !e.shiftKey && k === 's') {
    e.preventDefault();
    void runAction('download-md');
  } else if (!e.altKey && !e.shiftKey && k === 'o') {
    e.preventDefault();
    fileInput.click();
  } else if (!e.altKey && !e.shiftKey && k === 'p') {
    e.preventDefault();
    void runAction('print'); // draw pending diagrams first
  }
});

if (!isMac) {
  // Show Ctrl/Alt instead of ⌘/⌥ in hints.
  document.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => (el.dataset.tip = key(el.dataset.tip!)));
  document.querySelectorAll<HTMLElement>('.menu kbd').forEach((el) => (el.textContent = key(el.textContent ?? '')));
}

/* Shared links --------------------------------------------------------- */

function openSharedFromHash() {
  const s = readShareHash();
  if (!s) return;
  clearShareHash();
  replaceDocument(s.doc, s.title, 'Opened a shared document');
}
window.addEventListener('hashchange', openSharedFromHash);

/* Installed app: open .md files from the OS ("Open with Folio") -------- */

interface LaunchParams {
  files: Array<{ getFile(): Promise<File> }>;
}
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
launchQueue?.setConsumer(async (params) => {
  const handle = params.files[0];
  if (handle) void openFile(await handle.getFile());
});

/* Offline support ------------------------------------------------------ */

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const offer = (worker: ServiceWorker) =>
          toast('A new version of Folio is ready', {
            duration: 15000,
            action: { label: 'Reload', run: () => worker.postMessage('skip-waiting') },
          });
        if (reg.waiting && hadController) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
          });
        });
      })
      .catch((err) => console.warn('[sw] registration failed', err));
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing to reload
    reloading = true;
    persist();
    location.reload();
  });
}

/* Boot ----------------------------------------------------------------- */

setTitle(title);
setSplit(settings.split);
previewEl.classList.toggle('serif', settings.serif);
setChecked('toggle-sync', settings.sync);
setChecked('toggle-serif', settings.serif);
setChecked('toggle-outline', settings.outline);
setPageWidth(settings.width);
applyFocus();
applyTheme(false);
applyView();
renderNow();
root.classList.remove('has-draft');

if (shared) {
  clearShareHash();
  if (savedDoc !== null && savedDoc.trim() && savedDoc !== shared.doc) {
    // Keep the visitor's own draft one click away.
    save('backup', { doc: savedDoc, title: savedTitle });
    toast('Opened a shared document', {
      duration: 9000,
      action: {
        label: 'Restore my draft',
        run: () => {
          replaceDoc(view, savedDoc);
          setTitle(savedTitle);
          persist();
        },
      },
    });
  }
  persist();
}

if (settings.view !== 'preview' && !isNarrow.matches) view.focus();
