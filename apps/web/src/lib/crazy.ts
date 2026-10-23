// The Crazy theme: every part of the page is a solid block of one bright colour.
// Blocks are painted at random as they appear (data-c="0".."9"), never the same
// colour as the block they sit in or the one right before them. Styles live in
// app.css under [data-theme='crazy'].

const BLOCKS = [
  '.section',
  '.card',
  '.chip',
  '.crew-chip',
  '.create-tile',
  '.pill',
  '.btn',
  '.tab',
  '.tab-create',
  '.rail-link',
  '.date-tile',
  '.day',
  '.list-item',
  '.note-row',
  '.notification',
  '.comment-body',
  '.checklist-item',
  '.personal-row',
  '.quote',
  '.banner',
  '.empty',
  '.tabs button',
  '.seg button',
  '.crew-emoji',
].join(', ');

/** Every piece of text gets its own colour too, as a highlighter patch. */
const TEXT = [
  'h1',
  'h2',
  'h3',
  'p',
  'label',
  '.label',
  '.eyebrow',
  '.greeting',
  '.event-title',
  '.chapter-title',
  '.idea-title',
  '.chapter-date',
  '.person-name',
  '.meta > span',
  '.meta > a',
  '.hint',
  '.tiny',
  '.small',
  '.more',
  '.wordmark-name',
  '.wordmark-tag',
  '.backronym',
  '.story-title',
  '.quote-text',
  '.quote-by',
  '.note-body',
  '.contribution-by > span',
].join(', ');

const COLORS = 10;

let observer: MutationObserver | null = null;

function pick(el: HTMLElement): string {
  const avoid = new Set<string>();
  const parent = el.parentElement?.closest<HTMLElement>('[data-c]');
  if (parent?.dataset.c) avoid.add(parent.dataset.c);
  const prev = el.previousElementSibling as HTMLElement | null;
  if (prev?.dataset.c) avoid.add(prev.dataset.c);
  let c: string;
  do c = String(Math.floor(Math.random() * COLORS));
  while (avoid.has(c));
  return c;
}

const ALL = `${BLOCKS}, ${TEXT}`;

function paint(root: Element) {
  const found = root.matches(ALL) ? [root, ...root.querySelectorAll(ALL)] : [...root.querySelectorAll(ALL)];
  // Document order: containers are painted before what's inside them.
  for (const el of found as HTMLElement[]) {
    if (el.dataset.c) continue;
    el.dataset.c = pick(el);
    if (!el.matches(BLOCKS)) el.dataset.t = '';
  }
}

export function startCrazy() {
  paint(document.body);
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) for (const node of m.addedNodes) if (node instanceof Element) paint(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function stopCrazy() {
  observer?.disconnect();
  observer = null;
}

/** New colours for everything on screen. */
export function rollCrazy() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-c]')) {
    delete el.dataset.c;
    delete el.dataset.t;
  }
  paint(document.body);
}
