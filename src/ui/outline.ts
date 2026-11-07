export interface Heading {
  id: string;
  level: number; // 1–4, relative to the document's top heading level
  text: string;
  line: number; // 0-based source line
  el: HTMLElement;
}

const RAIL_MAX = 30;

/** Heading text without the hover `#` anchor. */
function headingText(h: HTMLElement): string {
  let text = '';
  for (const node of h.childNodes) {
    if (node instanceof Element && node.classList.contains('anchor')) continue;
    text += node.textContent ?? '';
  }
  return text.trim();
}

export function collectHeadings(content: HTMLElement): Heading[] {
  const els = [...content.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3, :scope > h4')];
  const min = Math.min(...els.map((h) => Number(h.tagName[1])));
  return els
    .filter((h) => h.id)
    .map((el) => ({
      id: el.id,
      level: Number(el.tagName[1]) - min + 1,
      text: headingText(el) || 'Untitled section',
      line: Number(el.dataset.line ?? 0),
      el,
    }));
}

/**
 * A quiet outline at the preview's right edge: a column of short dashes that
 * opens into the list of headings on hover, tracking the section in view.
 */
export class Outline {
  enabled = true;
  private headings: Heading[] = [];
  private signature = '';
  private frame = 0;
  private rail: HTMLElement;
  private list: HTMLElement;

  constructor(
    private nav: HTMLElement,
    private scroller: HTMLElement,
    private content: HTMLElement,
    private onJump: (h: Heading) => void,
  ) {
    this.rail = nav.querySelector('.toc-rail')!;
    this.list = nav.querySelector('.toc-list')!;
    scroller.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.updateActive());
      },
      { passive: true },
    );
    this.list.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('a[data-index]');
      if (!a) return;
      e.preventDefault();
      const h = this.headings[Number(a.dataset.index)];
      if (h) this.onJump(h);
    });
  }

  get items(): Heading[] {
    return this.headings;
  }

  refresh() {
    this.headings = collectHeadings(this.content);
    const sig = this.headings.map((h) => `${h.level}${h.id}\u0000${h.text}`).join('\u0001');
    if (sig !== this.signature) {
      this.signature = sig;
      this.build();
    }
    this.nav.hidden = !this.enabled || this.headings.length < 2;
    this.updateActive();
  }

  private build() {
    this.list.replaceChildren(
      ...this.headings.map((h, i) => {
        const li = document.createElement('li');
        li.className = `l${Math.min(h.level, 4)}`;
        const a = document.createElement('a');
        a.href = `#${h.id}`;
        a.dataset.index = String(i);
        a.textContent = h.text;
        a.title = h.text;
        li.append(a);
        return li;
      }),
    );

    // Long documents: keep the rail short by showing only the top two levels.
    let railItems = this.headings.map((h, i) => ({ h, i }));
    if (railItems.length > RAIL_MAX) railItems = railItems.filter(({ h }) => h.level <= 2).slice(0, RAIL_MAX);
    this.rail.replaceChildren(
      ...railItems.map(({ h, i }) => {
        const s = document.createElement('span');
        s.className = `l${Math.min(h.level, 4)}`;
        s.dataset.index = String(i);
        return s;
      }),
    );
  }

  private updateActive() {
    if (this.nav.hidden || !this.headings.length) return;
    const s = this.scroller;
    const y = s.getBoundingClientRect().top + 96;
    let active = -1;
    if (s.scrollTop + s.clientHeight >= s.scrollHeight - 4) active = this.headings.length - 1;
    else {
      for (let i = 0; i < this.headings.length; i++) {
        if (this.headings[i].el.getBoundingClientRect().top <= y) active = i;
        else break;
      }
    }
    this.list.querySelectorAll('a').forEach((a, i) => a.classList.toggle('active', i === active));
    let railActive: Element | null = null;
    for (const span of this.rail.children) {
      span.classList.remove('active');
      if (Number((span as HTMLElement).dataset.index) <= active) railActive = span;
    }
    railActive?.classList.add('active');
  }
}
