import DOMPurify from 'dompurify';

let hooked = false;

function setup() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
    // The only input a Markdown document needs is a task checkbox.
    if (node.tagName === 'INPUT') node.setAttribute('type', 'checkbox');
  });
}

const CONFIG = {
  // <style> would restyle the whole app; forms have no place in a document.
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option'],
  FORBID_ATTR: ['autofocus'],
};

export function sanitizeToFragment(html: string): DocumentFragment {
  setup();
  return DOMPurify.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
}

export function sanitizeToString(html: string): string {
  setup();
  return DOMPurify.sanitize(html, CONFIG);
}
