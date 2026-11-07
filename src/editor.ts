import { EditorState, EditorSelection, Compartment, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  placeholder,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--text)', fontWeight: '700' },
  { tag: [t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--text)', fontWeight: '650' },
  { tag: t.processingInstruction, color: 'var(--faint)' }, // # ** ` > - markers
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)', textDecoration: 'underline', textDecorationColor: 'var(--border-strong)' },
  { tag: t.monospace, color: 'var(--text-2)' },
  { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--text)' },
  { tag: t.contentSeparator, color: 'var(--faint)' },
  { tag: t.labelName, color: 'var(--muted)' },
  { tag: t.meta, color: 'var(--muted)' },
  { tag: [t.angleBracket, t.tagName], color: 'var(--syn-type)' },
  { tag: t.attributeName, color: 'var(--syn-variable)' },

  // Code inside fences
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.moduleKeyword, t.definitionKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName], color: 'var(--syn-property)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--syn-variable)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.operator], color: 'var(--syn-punct)' },
  { tag: t.invalid, color: 'var(--caution)' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    color: 'var(--text)',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.75',
    overflowX: 'hidden',
  },
  '.cm-content': {
    maxWidth: '78ch',
    margin: '0 auto',
    padding: '48px clamp(20px, 4vw, 48px) 40vh',
    caretColor: 'var(--accent)',
    fontVariantLigatures: 'none',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)', marginLeft: '-1px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
    boxShadow: '-12px 0 0 var(--bg-hover), 12px 0 0 var(--bg-hover)',
    borderRadius: '2px',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent-soft)',
    outline: 'none',
  },
  '.cm-placeholder': { color: 'var(--faint)', fontStyle: 'normal' },

  // Search panel, restyled to match the app
  '.cm-panels': {
    backgroundColor: 'var(--bg-elev)',
    color: 'var(--text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12.5px',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-search': { padding: '8px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' },
  '.cm-search br': { display: 'none' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--muted)', fontSize: '12px' },
  '.cm-textfield': {
    font: 'inherit',
    padding: '4px 8px',
    margin: '0',
    borderRadius: '6px',
    border: '1px solid var(--border-strong)',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
  },
  '.cm-textfield:focus': { outline: '2px solid var(--accent-soft)', borderColor: 'var(--accent)' },
  '.cm-button': {
    font: 'inherit',
    margin: '0',
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    backgroundImage: 'none',
    backgroundColor: 'var(--bg-subtle)',
    color: 'var(--text)',
    textTransform: 'capitalize',
  },
  '.cm-button:hover': { backgroundColor: 'var(--bg-active)' },
  '.cm-panel.cm-search [name=close]': {
    color: 'var(--muted)',
    fontSize: '16px',
    right: '10px',
    top: '6px',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-line)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--selection)' },
});

/** Wrap the selection in a marker (bold, italic, code), or remove it if already wrapped. */
function toggleWrap(marker: string) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const len = marker.length;
    const tr = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - len, range.from);
      const after = state.sliceDoc(range.to, range.to + len);
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - len, to: range.from, insert: '' },
            { from: range.to, to: range.to + len, insert: '' },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + len, range.to + len),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
    return true;
  };
}

export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const isUrl = /^https?:\/\/\S+$/.test(text);
    const insert = isUrl ? `[](${text})` : `[${text}](url)`;
    // Select the part the user most likely wants to type next.
    const sel = isUrl
      ? EditorSelection.cursor(range.from + 1)
      : EditorSelection.range(range.from + text.length + 3, range.from + text.length + 6);
    return { changes: { from: range.from, to: range.to, insert }, range: sel };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  return true;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (doc: string) => void;
  onCursor: (line: number, col: number) => void;
}

export function createEditor({ parent, doc, onChange, onCursor }: EditorOptions): EditorView {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    placeholder('Start writing…'),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(highlightStyle),
    theme,
    focusCompartment.of([]),
    keymap.of([
      { key: 'Mod-b', run: toggleWrap('**') },
      { key: 'Mod-i', run: toggleWrap('*') },
      { key: 'Mod-e', run: toggleWrap('`') },
      { key: 'Mod-Shift-k', run: insertLink },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', 'aria-label': 'Markdown source' }),
    EditorView.updateListener.of((u: ViewUpdate) => {
      if (u.docChanged) onChange(u.state.doc.toString());
      if (u.docChanged || u.selectionSet) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        onCursor(line.number, head - line.from + 1);
      }
    }),
  ];

  return new EditorView({
    parent,
    state: EditorState.create({ doc, extensions }),
  });
}

/** Replace the whole document as one undoable step. */
export function replaceDoc(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
    scrollIntoView: true,
    userEvent: 'set',
  });
  view.scrollDOM.scrollTop = 0;
}

/* Focus mode: dim everything except the paragraph being written. ---------- */

const focusCompartment = new Compartment();
const dimLine = Decoration.line({ class: 'cm-dim' });

function paragraphAround(state: EditorState): [number, number] {
  const doc = state.doc;
  let a = doc.lineAt(state.selection.main.head).number;
  let b = a;
  if (doc.line(a).text.trim()) {
    while (a > 1 && doc.line(a - 1).text.trim()) a--;
    while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
  }
  return [a, b];
}

function dimDecorations(view: EditorView): DecorationSet {
  const [a, b] = paragraphAround(view.state);
  const builder = new RangeSetBuilder<Decoration>();
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.number > lastLine && (line.number < a || line.number > b)) builder.add(line.from, line.from, dimLine);
      lastLine = Math.max(lastLine, line.number);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = dimDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = dimDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function setFocusMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: focusCompartment.reconfigure(on ? focusPlugin : []) });
}

/* Snippets and navigation ------------------------------------------------ */

const CURSOR = '¦';

/** Insert a block on its own lines at the cursor. `¦` marks where the cursor lands. */
export function insertBlock(view: EditorView, snippet: string) {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const atEmptyLine = !line.text.trim();
  const from = atEmptyLine ? line.from : line.to;
  const prevLine = line.number > 1 ? state.doc.line(line.number - 1) : null;
  let before = '';
  if (!atEmptyLine) before = '\n\n';
  else if (prevLine && prevLine.text.trim()) before = '\n';
  const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const after = nextLine && nextLine.text.trim() ? '\n' : '';

  const body = snippet.replace(/\n$/, '');
  const caret = body.indexOf(CURSOR);
  const text = before + body.replace(CURSOR, '') + after;
  const to = atEmptyLine ? line.to : line.to;
  const anchor = from + before.length + (caret === -1 ? body.length : caret);
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** Insert a footnote reference at the cursor and its definition at the end. */
export function insertFootnote(view: EditorView) {
  const { state } = view;
  const used = [...state.doc.toString().matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
  const n = used.length ? Math.max(...used) + 1 : 1;
  const pos = state.selection.main.head;
  const end = state.doc.length;
  const tail = state.doc.toString().endsWith('\n') ? '\n' : '\n\n';
  const def = `${tail}[^${n}]: `;
  view.dispatch({
    changes: [
      { from: pos, insert: `[^${n}]` },
      { from: end, insert: def },
    ],
    selection: { anchor: end + `[^${n}]`.length + def.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** Move the cursor to the start of a (0-based) line and bring it into view. */
export function goToLine(view: EditorView, line0: number) {
  const n = Math.min(view.state.doc.lines, Math.max(1, line0 + 1));
  const pos = view.state.doc.line(n).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 48 }),
  });
}
