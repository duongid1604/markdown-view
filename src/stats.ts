const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
const WORDS_PER_MINUTE = 230;
const nf = new Intl.NumberFormat('en-US');

export function countWords(text: string): number {
  let n = 0;
  WORD.lastIndex = 0;
  while (WORD.exec(text)) n++;
  return n;
}

export function describe(text: string) {
  const words = countWords(text);
  const minutes = Math.ceil(words / WORDS_PER_MINUTE);
  return {
    words: `${nf.format(words)} ${words === 1 ? 'word' : 'words'}`,
    chars: `${nf.format(text.length)} ${text.length === 1 ? 'character' : 'characters'}`,
    read: words < WORDS_PER_MINUTE / 2 ? '< 1 min read' : `${Math.max(1, minutes)} min read`,
  };
}
