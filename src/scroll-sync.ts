import type { EditorView } from '@codemirror/view';

interface Anchor {
  line: number; // 0-based source line
  top: number; // offset inside the preview's scroll content
}

/**
 * Keeps the editor and the preview scrolled to the same place.
 * Elements in the preview carry `data-line` (their first source line); we
 * interpolate between those anchors in both directions.
 */
export class ScrollSync {
  enabled = true;
  private anchors: Anchor[] | null = null;
  private skipEditor = false;
  private skipPreview = false;
  private frame = 0;

  constructor(
    private view: EditorView,
    private scroller: HTMLElement,
    private content: HTMLElement,
  ) {
    view.scrollDOM.addEventListener('scroll', () => this.onScroll('editor'), { passive: true });
    scroller.addEventListener('scroll', () => this.onScroll('preview'), { passive: true });
    new ResizeObserver(() => this.invalidate()).observe(content);
  }

  invalidate() {
    this.anchors = null;
  }

  /** Align the preview to the editor (after a render, a resize, a view change). */
  syncFromEditor() {
    if (!this.enabled) return;
    this.invalidate();
    this.fromEditor();
  }

  private onScroll(source: 'editor' | 'preview') {
    if (source === 'editor' && this.skipEditor) return void (this.skipEditor = false);
    if (source === 'preview' && this.skipPreview) return void (this.skipPreview = false);
    if (!this.enabled) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => (source === 'editor' ? this.fromEditor() : this.fromPreview()));
  }

  private visible(el: HTMLElement) {
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  private getAnchors(): Anchor[] {
    if (this.anchors) return this.anchors;
    const base = this.scroller.getBoundingClientRect().top - this.scroller.scrollTop;
    const list: Anchor[] = [{ line: 0, top: 0 }];
    for (const el of this.content.querySelectorAll<HTMLElement>('[data-line]')) {
      if (!this.visible(el)) continue;
      const line = Number(el.dataset.line);
      const top = el.getBoundingClientRect().top - base;
      const last = list[list.length - 1];
      if (line > last.line && top > last.top) list.push({ line, top });
    }
    const lastChild = this.content.lastElementChild;
    const end = lastChild ? lastChild.getBoundingClientRect().bottom - base : 0;
    const last = list[list.length - 1];
    const lines = this.view.state.doc.lines;
    if (lines > last.line && end > last.top) list.push({ line: lines, top: end });
    this.anchors = list;
    return list;
  }

  private setScroll(el: HTMLElement, value: number, which: 'editor' | 'preview') {
    const before = el.scrollTop;
    el.scrollTop = value;
    if (Math.abs(el.scrollTop - before) >= 1) {
      if (which === 'editor') this.skipEditor = true;
      else this.skipPreview = true;
    }
  }

  private atBottom(el: HTMLElement) {
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  }

  private fromEditor() {
    const v = this.view;
    const sd = v.scrollDOM;
    if (sd.scrollTop <= 0) return this.setScroll(this.scroller, 0, 'preview');
    if (this.atBottom(sd) && sd.scrollTop > 0) {
      return this.setScroll(this.scroller, this.scroller.scrollHeight, 'preview');
    }

    // Source position (fractional line) at the top of the editor viewport.
    const h = sd.getBoundingClientRect().top - v.documentTop;
    const block = v.lineBlockAtHeight(Math.max(0, h));
    const first = v.state.doc.lineAt(block.from).number - 1;
    const lastLine = v.state.doc.lineAt(block.to).number;
    const frac = block.height > 0 ? Math.min(1, Math.max(0, (h - block.top) / block.height)) : 0;
    const srcLine = first + frac * (lastLine - first);

    const anchors = this.getAnchors();
    let i = 0;
    while (i < anchors.length - 1 && anchors[i + 1].line <= srcLine) i++;
    const a = anchors[i];
    const b = anchors[i + 1];
    const top = b ? a.top + ((srcLine - a.line) / (b.line - a.line)) * (b.top - a.top) : a.top;
    this.setScroll(this.scroller, top, 'preview');
  }

  private fromPreview() {
    const v = this.view;
    const sd = v.scrollDOM;
    const p = this.scroller;
    if (p.scrollTop <= 0) return this.setScroll(sd, 0, 'editor');
    if (this.atBottom(p)) return this.setScroll(sd, sd.scrollHeight, 'editor');

    const anchors = this.getAnchors();
    const y = p.scrollTop;
    let i = 0;
    while (i < anchors.length - 1 && anchors[i + 1].top <= y) i++;
    const a = anchors[i];
    const b = anchors[i + 1];
    const srcLine = b ? a.line + ((y - a.top) / (b.top - a.top)) * (b.line - a.line) : a.line;

    const doc = v.state.doc;
    const n = Math.min(doc.lines, Math.max(1, Math.floor(srcLine) + 1));
    const block = v.lineBlockAt(doc.line(n).from);
    const frac = srcLine - Math.floor(srcLine);
    const docOffset = v.documentTop - sd.getBoundingClientRect().top + sd.scrollTop;
    this.setScroll(sd, docOffset + block.top + frac * block.height, 'editor');
  }
}
