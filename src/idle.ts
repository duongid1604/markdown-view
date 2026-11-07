/** Run when the browser is idle (or after `timeout` ms at the latest), keeping start-up responsive. */
export function whenIdle(fn: () => void, timeout = 1500) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, 120);
}
