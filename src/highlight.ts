import { resolveLang } from './highlight-langs';
import { whenIdle } from './idle';

/**
 * Syntax highlighting runs in a Web Worker (see highlight.worker.ts), so
 * typing and scrolling never wait for it. `highlight()` answers from a cache;
 * on a miss it asks the worker and returns null (plain code for now), then
 * `onReady` asks the app to render again once results arrive.
 */

const CACHE_LIMIT = 400;
const cache = new Map<string, string>();
const pending = new Map<number, string>(); // request id -> cache key
const requested = new Set<string>();
let worker: Worker | null = null;
let failed = false;
let nextId = 0;
let onReady: () => void = () => {};
let readyFrame = 0;

export function onHighlighterReady(fn: () => void) {
  onReady = fn;
}

function getWorker(): Worker | null {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    failed = true;
    console.warn('[highlight] workers unavailable; code stays plain', err);
    return null;
  }
  worker.addEventListener('message', (e: MessageEvent<{ id: number; html: string | null; error?: string }>) => {
    const key = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (key === undefined) return;
    if (e.data.html) {
      cache.set(key, e.data.html);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    } else if (e.data.error) {
      console.warn('[highlight]', e.data.error);
    }
    // Several blocks usually finish together: render once per frame.
    cancelAnimationFrame(readyFrame);
    readyFrame = requestAnimationFrame(() => onReady());
  });
  worker.addEventListener('error', (err) => {
    failed = true;
    console.warn('[highlight] worker failed; code stays plain', err.message);
  });
  return worker;
}

export function highlight(code: string, lang: string): string | null {
  const id = resolveLang(lang);
  if (!id) return null;
  const source = code.replace(/\n$/, '');
  const key = `${id}\u0000${source}`;

  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key); // keep recently used entries at the end
    cache.set(key, hit);
    return hit;
  }

  if (!requested.has(key)) {
    requested.add(key);
    if (requested.size > CACHE_LIMIT * 4) requested.clear();
    // The first request waits for an idle moment so start-up stays smooth.
    const send = () => {
      const w = getWorker();
      if (!w) return;
      const reqId = ++nextId;
      pending.set(reqId, key);
      w.postMessage({ id: reqId, code: source, lang: id });
    };
    if (worker) send();
    else whenIdle(send);
  }
  return null;
}
