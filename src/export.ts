import tokensCss from './styles/tokens.css?inline';
import proseCss from './styles/prose.css?inline';

const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg-elev);color:var(--text)}
main{padding:72px 24px 120px}
@media (max-width:640px){main{padding:40px 16px 80px}}
@media print{body{background:#fff}main{padding:0}.prose .anchor{display:none}}
`;

export function fileNameFor(title: string, ext: string): string {
  const base =
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'untitled';
  return `${base}.${ext}`;
}

/** The rendered preview without app-only bits (copy buttons, source-line markers). */
export function cleanPreviewHtml(preview: HTMLElement): string {
  const clone = preview.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.code-copy').forEach((n) => n.remove());
  clone.querySelectorAll('input[type="checkbox"]').forEach((n) => n.setAttribute('disabled', ''));
  clone.querySelectorAll('[data-line], [data-task-line], [data-key], [data-rendered]').forEach((n) => {
    n.removeAttribute('data-line');
    n.removeAttribute('data-task-line');
    n.removeAttribute('data-key');
    n.removeAttribute('data-rendered');
  });
  return clone.innerHTML.trim();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A single self-contained HTML file that looks like the preview, in light and dark. */
export function buildStandaloneHtml(
  title: string,
  preview: HTMLElement,
  serif: boolean,
  katexVersion: string | null,
  width = '70ch',
): string {
  // KaTeX needs its stylesheet and fonts; link the matching version from a CDN only when math is present.
  const katexLink =
    katexVersion && preview.querySelector('.katex')
      ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katexVersion}/dist/katex.min.css" crossorigin="anonymous">\n`
      : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title || 'Untitled')}</title>
${katexLink}<style>
${tokensCss}
${PAGE_CSS}
${proseCss}
</style>
</head>
<body>
<main class="prose${serif ? ' serif' : ''}" style="--prose-width:${width}">
${cleanPreviewHtml(preview)}
</main>
</body>
</html>
`;
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
