import { describe, expect, it } from 'vitest';
import { createRenderer, slugify } from '../src/render';
import { sanitizeToString } from '../src/sanitize';
import { countWords, describe as describeText } from '../src/stats';
import { fileNameFor } from '../src/export';

const render = createRenderer();
const html = (src: string) => sanitizeToString(render(src));

describe('GitHub-flavored Markdown', () => {
  it('renders tables', () => {
    const out = html('| a | b |\n| - | -: |\n| 1 | 2 |');
    expect(out).toContain('<table');
    expect(out).toContain('<th');
    expect(out).toContain('text-align:right');
  });

  it('renders strikethrough and autolinks', () => {
    const out = html('~~gone~~ see https://example.com');
    expect(out).toContain('<s>gone</s>');
    expect(out).toMatch(/<a href="https:\/\/example.com"[^>]*target="_blank"/);
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('renders task lists with source lines', () => {
    const out = html('- [ ] todo\n- [x] done\n- plain');
    expect(out).toContain('class="contains-task-list"');
    expect(out).toMatch(/<input[^>]*data-task-line="0"/);
    expect(out).toMatch(/<input[^>]*checked[^>]*>done|<input[^>]*data-task-line="1"[^>]*checked/);
    expect(out).toContain('task-list-item checked');
    expect(out).not.toContain('[ ]');
    expect(out).not.toContain('[x]');
    expect((out.match(/<input/g) ?? []).length).toBe(2);
  });

  it('renders GitHub alerts', () => {
    const out = html('> [!WARNING]\n> Careful now.');
    expect(out).toContain('class="alert alert-warning"');
    expect(out).toContain('alert-title');
    expect(out).toContain('Warning');
    expect(out).toContain('Careful now.');
    expect(out).not.toContain('[!WARNING]');
  });

  it('leaves ordinary blockquotes alone', () => {
    const out = html('> [!NOTE] inline is not an alert');
    expect(out).not.toContain('alert-note');
  });

  it('renders footnotes', () => {
    const out = html('Text[^1]\n\n[^1]: The note.');
    expect(out).toContain('footnote-ref');
    expect(out).toContain('class="footnotes"');
  });

  it('gives headings unique, prefixed ids', () => {
    const out = html('# Hello World\n\n## Hello World\n\n## Title');
    expect(out).toContain('id="h-hello-world"');
    expect(out).toContain('id="h-hello-world-1"');
    expect(out).toContain('id="h-title"');
    expect(out).toContain('href="#hello-world"');
  });

  it('marks blocks with their source line', () => {
    const out = html('# A\n\npara\n\n```js\nx\n```');
    expect(out).toMatch(/<h1[^>]*data-line="0"/);
    expect(out).toContain('<p data-line="2"');
    expect(out).toContain('class="code-block" data-line="4"');
  });

  it('escapes code when no highlighter is ready', () => {
    const out = html('```html\n<b>bold</b>\n```');
    expect(out).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(out).toContain('class="code-lang">html<');
  });

  it('uses the highlighter when it returns HTML', () => {
    const r = createRenderer({ highlight: (code, lang) => `<pre class="shiki" data-lang="${lang}"><code>${code.length}</code></pre>` });
    const out = r('```TS\nabc\n```');
    expect(out).toContain('data-lang="ts"');
  });
});

describe('math and diagrams', () => {
  const calls: Array<[string, boolean]> = [];
  const r = createRenderer({
    math: (tex, display) => (calls.push([tex, display]), `<M d="${display}">${tex}</M>`),
    diagram: (code) => `k${code.length}`,
  });

  it('parses inline math', () => {
    expect(r('Euler: $e^{i\\pi}+1=0$.')).toContain('<span class="math-inline"><M d="false">e^{i\\pi}+1=0</M></span>');
  });

  it('leaves prices alone', () => {
    calls.length = 0;
    r('It costs $5 and $10, or US$3 each. Also $ 4 $.');
    expect(calls).toHaveLength(0);
  });

  it('respects escaped dollars', () => {
    calls.length = 0;
    r('\\$not math\\$');
    expect(calls).toHaveLength(0);
  });

  it('parses display math on one line and across lines', () => {
    calls.length = 0;
    const out = r('$$a+b$$\n\ntext\n\n$$\n\\int_0^1 x\\,dx\n$$');
    expect(calls).toEqual([
      ['a+b', true],
      ['\\int_0^1 x\\,dx', true],
    ]);
    expect(out).toContain('class="math-block" data-line="0"');
    expect(out).toContain('class="math-block" data-line="4"');
  });

  it('does not treat an unclosed $$ as math', () => {
    calls.length = 0;
    expect(r('$$\nnot closed')).toContain('<p');
    expect(calls).toHaveLength(0);
  });

  it('renders ```math fences', () => {
    calls.length = 0;
    r('```math\nx^2\n```');
    expect(calls).toEqual([['x^2', true]]);
  });

  it('shows the source while math is loading', () => {
    expect(createRenderer()('$x$')).toContain('math-inline pending');
  });

  it('marks mermaid fences as diagrams', () => {
    const out = r('```mermaid\ngraph TD; A-->B\n```');
    expect(out).toContain('class="diagram" data-key="k16" data-line="0"');
    expect(out).toContain('graph TD; A--&gt;B');
  });
});

describe('sanitizing', () => {
  it('removes scripts, handlers and javascript: URLs', () => {
    const out = html('<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('javascript:');
  });

  it('removes style tags and forms', () => {
    const out = html('<style>body{display:none}</style><form><input type="password"><button>Go</button></form>');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('password');
  });

  it('keeps KaTeX-style MathML', () => {
    const out = sanitizeToString(
      '<span class="katex"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></span>',
    );
    expect(out).toContain('<mi>x</mi>');
  });

  it('keeps safe inline HTML', () => {
    const out = html('<details><summary>More</summary>\n\nHidden\n\n</details>\n\n<kbd>K</kbd> <mark>m</mark>');
    expect(out).toContain('<details');
    expect(out).toContain('<summary>More</summary>');
    expect(out).toContain('<kbd>K</kbd>');
    expect(out).toContain('<mark>m</mark>');
  });
});

describe('helpers', () => {
  it('slugifies like GitHub', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('Tiếng Việt có dấu')).toBe('tiếng-việt-có-dấu');
    expect(slugify('  a  b  ')).toBe('a-b');
  });

  it('counts words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords("It's a well-known fact — 42 times.")).toBe(6);
    expect(describeText('one').words).toBe('1 word');
  });

  it('makes safe file names', () => {
    expect(fileNameFor('My notes: draft/2', 'md')).toBe('My-notes-draft2.md');
    expect(fileNameFor('   ', 'html')).toBe('untitled.html');
  });
});
