# Folio

A quiet Markdown editor with a live preview. Static and client-only: nothing is uploaded, drafts stay in the browser, and it works offline once visited.

## Features

**Writing**
- CodeMirror 6 editor with Markdown highlighting, `⌘B` `⌘I` `⌘E` for bold, italic and code, `⇧⌘K` for links
- Focus mode (`⌥⌘F`) dims everything but the paragraph you are on
- `⌘K` command menu: every action, snippets (table, code, math, diagram, callout, task list, footnote), jump to any heading

**Preview**
- GitHub-flavored Markdown: tables, task lists (clickable), strikethrough, autolinks, footnotes, `> [!NOTE]` alerts
- Code highlighting with Shiki in a Web Worker; each grammar loads on first use; colors adjusted to meet WCAG AA
- Math with KaTeX (`$…$`, `$$…$$`, ` ```math `), diagrams with Mermaid (` ```mermaid `) in the page's own colors; both load only when a document uses them
- Outline rail at the preview's edge, heading anchors, copy buttons, scroll sync

**Files and sharing**
- Autosave; drag-and-drop or `⌘O` to open; `⌘S` downloads `.md`
- Export a standalone `.html` (light and dark), copy HTML, print / save as PDF
- Share links that carry the whole document in the URL hash (no server)

**Everything else**
- Light, dark or system theme; optional serif preview; phone layout
- Installable PWA with offline support and "Open with" for `.md` files
- Output sanitized with DOMPurify
- The welcome page is pre-rendered into `index.html` at build time, so it appears before any JavaScript runs

Lighthouse (local build): desktop 100 / 100 / 100 / 100; mobile 99 / 100 / 100 / 100 with applied throttling.

## Develop

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests: render pipeline, math, sanitizing
npm run build     # static site in dist/
npm run preview   # serve dist/ locally (service worker is active here, not in dev)
```

## Deploy

`npm run build` produces a plain static folder, `dist/`. Asset paths are relative, so it works at a domain root or under a sub-path such as `https://<user>.github.io/<repo>/`.

- **GitHub Pages:** build with GitHub Actions and publish `dist/`.
- **Cloudflare Pages / Netlify / Vercel:** build command `npm run build`, output directory `dist`.

Optional: set `SITE_URL` when building (for example `SITE_URL=https://you.github.io/folio npm run build`) so link previews on social sites get an absolute `og:image` URL.

## Customize

- Name: `src/config.ts`, plus the `<title>`, meta tags and wordmark in `index.html`, and `public/manifest.webmanifest`.
- Colors and fonts: `src/styles/tokens.css`. Rendered Markdown: `src/styles/prose.css` (also used by HTML export).
- Welcome document: `src/sample.md`.
