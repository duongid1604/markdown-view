interface ToastOptions {
  action?: { label: string; run: () => void };
  duration?: number;
}

const region = () => document.getElementById('toasts')!;

export function toast(message: string, { action, duration = action ? 6000 : 2400 }: ToastOptions = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);

  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.run();
      close();
    });
    el.append(btn);
  }

  // Keep at most three on screen.
  const r = region();
  while (r.children.length >= 3) r.firstElementChild?.remove();
  r.append(el);
  timer = window.setTimeout(close, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => (timer = window.setTimeout(close, 1800)));
}
