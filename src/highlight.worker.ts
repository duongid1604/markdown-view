import type { HighlighterCore } from 'shiki/core';
import { LANGS } from './highlight-langs';
import { accessibleColors } from './contrast';

/* Syntax highlighting off the main thread: the page sends {id, code, lang},
   we answer {id, html}. Grammars load the first time they are needed. */

const THEMES = { light: 'vitesse-light', dark: 'vitesse-dark' } as const;

let corePromise: Promise<HighlighterCore> | null = null;
const langPromises = new Map<string, Promise<void>>();

function getCore(): Promise<HighlighterCore> {
  corePromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [import('@shikijs/themes/vitesse-light'), import('@shikijs/themes/vitesse-dark')],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return corePromise;
}

function ensureLang(core: HighlighterCore, id: string): Promise<void> {
  let p = langPromises.get(id);
  if (!p) {
    p = core.loadLanguage(LANGS[id]() as never);
    langPromises.set(id, p);
  }
  return p;
}

interface Request {
  id: number;
  code: string;
  lang: string;
}

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id, code, lang } = event.data;
  try {
    const core = await getCore();
    await ensureLang(core, lang);
    const html = accessibleColors(core.codeToHtml(code, { lang, themes: THEMES, defaultColor: false }));
    (self as unknown as Worker).postMessage({ id, html });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, html: null, error: String(err) });
  }
});
