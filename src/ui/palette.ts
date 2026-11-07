export interface Command {
  id: string;
  title: string;
  group: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface Match {
  cmd: Command;
  score: number;
  marks: number[];
}

/** Word-by-word substring matching, falling back to a subsequence match on the title. */
export function matchCommand(query: string, cmd: Command): Match | null {
  const q = query.trim().toLowerCase();
  if (!q) return { cmd, score: 0, marks: [] };
  const title = cmd.title.toLowerCase();
  const hay = `${title} ${(cmd.keywords ?? '').toLowerCase()} ${cmd.group.toLowerCase()}`;

  const words = q.split(/\s+/);
  if (words.every((w) => hay.includes(w))) {
    let score = 1000;
    const marks: number[] = [];
    for (const w of words) {
      const i = title.indexOf(w);
      if (i === -1) {
        score -= 300; // matched only through keywords or group
        continue;
      }
      score -= i;
      if (i === 0 || title[i - 1] === ' ') score += 40;
      for (let k = i; k < i + w.length; k++) marks.push(k);
    }
    return { cmd, score: score - title.length * 0.5, marks };
  }

  const marks: number[] = [];
  let j = 0;
  for (let k = 0; k < title.length && j < q.length; k++) {
    if (title[k] === q[j]) {
      marks.push(k);
      j++;
    }
  }
  if (j < q.length) return null;
  const spread = marks[marks.length - 1] - marks[0];
  return { cmd, score: 300 - spread * 4 - marks[0], marks };
}

function highlight(text: string, marks: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const set = new Set(marks);
  let buf = '';
  let inMark = false;
  const flush = () => {
    if (!buf) return;
    if (inMark) {
      const b = document.createElement('b');
      b.textContent = buf;
      frag.append(b);
    } else frag.append(buf);
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== inMark) {
      flush();
      inMark = m;
    }
    buf += text[i];
  }
  flush();
  return frag;
}

/** The ⌘K command menu. */
export function createPalette(getCommands: () => Command[]) {
  const overlay = document.getElementById('palette')!;
  const input = document.getElementById('palette-input') as HTMLInputElement;
  const list = document.getElementById('palette-list')!;
  const empty = overlay.querySelector<HTMLElement>('.palette-empty')!;
  let commands: Command[] = [];
  let shown: Command[] = [];
  let selected = 0;
  let restoreFocus: HTMLElement | null = null;

  function render() {
    const q = input.value;
    const matches = commands.map((c) => matchCommand(q, c)).filter((m): m is Match => m !== null);
    if (q.trim()) matches.sort((a, b) => b.score - a.score);

    list.replaceChildren();
    shown = [];
    let group = '';
    for (const m of matches.slice(0, 60)) {
      if (!q.trim() && m.cmd.group !== group) {
        group = m.cmd.group;
        const g = document.createElement('li');
        g.className = 'palette-group';
        g.setAttribute('role', 'presentation');
        g.textContent = group;
        list.append(g);
      }
      const li = document.createElement('li');
      li.className = 'palette-item';
      li.id = `palette-opt-${shown.length}`;
      li.setAttribute('role', 'option');
      li.dataset.index = String(shown.length);
      const label = document.createElement('span');
      label.className = 'label';
      label.append(highlight(m.cmd.title, m.marks));
      li.append(label);
      const hintText = m.cmd.hint ?? (q.trim() ? m.cmd.group : '');
      if (hintText) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = hintText;
        li.append(hint);
      }
      list.append(li);
      shown.push(m.cmd);
    }
    empty.hidden = shown.length > 0;
    select(0);
  }

  function select(i: number) {
    if (!shown.length) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    selected = (i + shown.length) % shown.length;
    list.querySelectorAll<HTMLElement>('.palette-item').forEach((el, k) => {
      el.setAttribute('aria-selected', String(k === selected));
      if (k === selected) el.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', `palette-opt-${selected}`);
  }

  function runSelected(i = selected) {
    const cmd = shown[i];
    if (!cmd) return;
    close(false);
    cmd.run();
  }

  function open() {
    if (!overlay.hidden) return;
    restoreFocus = document.activeElement as HTMLElement | null;
    commands = getCommands();
    input.value = '';
    overlay.hidden = false;
    render();
    input.focus();
  }

  function close(refocus = true) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    if (refocus) restoreFocus?.focus?.();
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      select(selected + 1);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      select(selected - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // keep focus inside the dialog
    }
  });
  list.addEventListener('mousemove', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.palette-item');
    if (item && Number(item.dataset.index) !== selected) select(Number(item.dataset.index));
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.palette-item');
    if (item) runSelected(Number(item.dataset.index));
  });
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });

  return {
    open,
    close,
    toggle: () => (overlay.hidden ? open() : close()),
    get isOpen() {
      return !overlay.hidden;
    },
  };
}
