/** A small popover menu anchored to a button, with keyboard support. */
export function setupMenu(button: HTMLElement, menu: HTMLElement, onAction: (action: string, item: HTMLElement) => void) {
  const items = () => [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];

  const position = () => {
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  };

  const open = (focusFirst = false) => {
    position();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    if (focusFirst) items()[0]?.focus();
  };

  const close = (restoreFocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(true);
    }
  });

  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!item) return;
    const keepOpen = item.getAttribute('role') === 'menuitemcheckbox';
    if (!keepOpen) close();
    onAction(item.dataset.action!, item);
  });

  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next].focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close(e.key === 'Escape');
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !button.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close(true);
  });
  window.addEventListener('resize', () => close());

  return { close };
}
