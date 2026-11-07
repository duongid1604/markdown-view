import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const KEY = 'share=';

/** Builds a link that carries the whole document in the URL hash; nothing is uploaded. */
export function buildShareUrl(title: string, doc: string): string {
  const data = compressToEncodedURIComponent(JSON.stringify({ t: title, d: doc }));
  const url = new URL(location.href);
  url.hash = KEY + data;
  return url.toString();
}

export function readShareHash(hash = location.hash): { title: string; doc: string } | null {
  const raw = hash.replace(/^#/, '');
  if (!raw.startsWith(KEY)) return null;
  try {
    const json = decompressFromEncodedURIComponent(raw.slice(KEY.length));
    if (!json) return null;
    const parsed = JSON.parse(json) as { t?: unknown; d?: unknown };
    if (typeof parsed.d !== 'string') return null;
    return { title: typeof parsed.t === 'string' ? parsed.t : 'Shared document', doc: parsed.d };
  } catch {
    return null;
  }
}

export function clearShareHash() {
  history.replaceState(null, '', location.pathname + location.search);
}
