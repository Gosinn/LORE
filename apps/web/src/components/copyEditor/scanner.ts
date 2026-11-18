// Live text editor: finding marked words on screen (LIVE_TEXT_SPEC 10.2, 10.3).
//
// In edit mode the runtime ends every editable text with an invisible marker naming its key. The scanner
// watches the page and puts `data-lore-copy="<keys>"` on each element holding marked text (in its own text
// or in a text attribute), plus `data-lore-copy-state` (draft / live / broken) for the outlines. React
// leaves attributes it didn't set alone; when it replaces a node, the observer marks the new one.
import { copyStore } from '../../lib/copy/runtime.ts';

export const TEXT_ATTRS = [
  'placeholder',
  'title',
  'aria-label',
  'alt',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'label',
] as const;

const ATTR_SELECTOR = TEXT_ATTRS.map((a) => `[${a}]`).join(',');
/** The editor's own UI: never scanned, never intercepted. */
export const UI_SELECTOR = '[data-lore-copy-ui]';
const OPEN = '\u2063';
const MARK = 'data-lore-copy';
const STATE = 'data-lore-copy-state';

function addKeys(text: string | null, keys: Set<string>) {
  for (const s of copyStore.decode(text)) keys.add(s.key);
}

function textKeys(el: Element): Set<string> {
  const keys = new Set<string>();
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) addKeys(n.nodeValue, keys);
  return keys;
}

export function attrKeys(el: Element): Set<string> {
  const keys = new Set<string>();
  for (const a of TEXT_ATTRS) addKeys(el.getAttribute(a), keys);
  return keys;
}

function stateOf(keys: Iterable<string>): string {
  const states = new Set<string>();
  const pending = copyStore.pending();
  for (const k of keys) {
    if (copyStore.problem(k)) states.add('broken');
    if (pending.has(k)) states.add('draft');
    else if (copyStore.current(k).source === 'published') states.add('live');
  }
  return [...states].join(' ');
}

function refresh(el: Element) {
  if (!el.isConnected || el.closest(UI_SELECTOR)) return;
  const keys = textKeys(el);
  for (const k of attrKeys(el)) keys.add(k);
  if (!keys.size) {
    if (el.hasAttribute(MARK)) el.removeAttribute(MARK);
    if (el.hasAttribute(STATE)) el.removeAttribute(STATE);
    return;
  }
  const value = [...keys].join(' ');
  if (el.getAttribute(MARK) !== value) el.setAttribute(MARK, value);
  const state = stateOf(keys);
  if (!state) el.removeAttribute(STATE);
  else if (el.getAttribute(STATE) !== state) el.setAttribute(STATE, state);
}

function collect(root: Node, dirty: Set<Element>) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (root.parentElement) dirty.add(root.parentElement);
    return;
  }
  if (!(root instanceof Element)) return;
  dirty.add(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue?.includes(OPEN) && n.parentElement) dirty.add(n.parentElement);
  }
  for (const el of root.querySelectorAll(ATTR_SELECTOR)) dirty.add(el);
  for (const el of root.querySelectorAll(`[${MARK}]`)) dirty.add(el);
}

/** Starts marking (edit mode on). Returns the function that stops and removes every mark. */
export function startScanner(): () => void {
  const html = document.documentElement;
  html.setAttribute('data-copy-editing', '');
  const dirty = new Set<Element>();
  let frame = 0;
  const flush = () => {
    frame = 0;
    for (const el of dirty) refresh(el);
    dirty.clear();
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') {
        if (r.target.parentElement) dirty.add(r.target.parentElement);
      } else if (r.type === 'attributes') {
        if (r.target instanceof Element) dirty.add(r.target);
      } else {
        if (r.target instanceof Element) dirty.add(r.target);
        for (const n of r.addedNodes) collect(n, dirty);
      }
    }
    queue();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TEXT_ATTRS],
  });
  collect(document.body, dirty);
  queue();
  // A publish changes a text's state without changing its words on screen.
  const unsubscribe = copyStore.subscribe(() => {
    for (const el of document.querySelectorAll(`[${MARK}]`)) dirty.add(el);
    queue();
  });
  return () => {
    observer.disconnect();
    unsubscribe();
    cancelAnimationFrame(frame);
    html.removeAttribute('data-copy-editing');
    for (const el of document.querySelectorAll(`[${MARK}]`)) {
      el.removeAttribute(MARK);
      el.removeAttribute(STATE);
    }
  };
}

// ------------------------------------------------------------------ what was tapped

export interface Hit {
  keys: string[];
  /** The element the words are in (for the popover's position and to give focus back). */
  el: Element;
}

type CaretDoc = Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };

/** The marked words right under a point: the text node at the caret, if the point is really on it. */
function wordsAt(x: number, y: number): Hit | null {
  let node: Node | null = null;
  let offset = 0;
  const doc = document as CaretDoc;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement || node.parentElement.closest(UI_SELECTOR)) return null;
  const segments = copyStore.decode(node.nodeValue);
  if (!segments.length) return null;
  // The caret API snaps to the nearest text even from empty space: only count it when the point is on it.
  const range = document.createRange();
  range.selectNodeContents(node);
  const on = [...range.getClientRects()].some((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
  if (!on) return null;
  const seg = segments.find((s) => offset <= s.end) ?? segments[segments.length - 1]!;
  return { keys: [seg.key], el: node.parentElement };
}

/** Which texts a tap (or a click) is about: the words under it, marked attributes, or a marked parent. */
export function hitTest(target: EventTarget | null, x: number | null, y: number | null): Hit | null {
  const start = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!start || start.closest(UI_SELECTOR)) return null;
  if (x !== null && y !== null && (x !== 0 || y !== 0)) {
    const hit = wordsAt(x, y);
    if (hit) return hit;
  }
  if (start instanceof HTMLSelectElement) {
    const keys = new Set<string>();
    for (const o of start.options) {
      addKeys(o.text, keys);
      for (const k of attrKeys(o)) keys.add(k);
    }
    for (const k of attrKeys(start)) keys.add(k);
    if (keys.size) return { keys: [...keys], el: start };
  }
  const own = attrKeys(start);
  if (own.size) return { keys: [...own], el: start };
  let el: Element | null = start;
  for (let depth = 0; el && depth <= 3; depth++, el = el.parentElement) {
    const v = el.getAttribute(MARK);
    if (v) return { keys: v.split(' '), el };
  }
  return null;
}

/** Every marked text inside an element (keyboard: Enter on a focused button). */
export function keysWithin(el: Element): string[] {
  const keys = new Set<string>();
  for (const k of el.getAttribute(MARK)?.split(' ') ?? []) if (k) keys.add(k);
  for (const child of el.querySelectorAll(`[${MARK}]`)) for (const k of child.getAttribute(MARK)!.split(' ')) if (k) keys.add(k);
  return [...keys];
}

/**
 * The texts on this screen. `hidden`: ones you can't tap well (placeholders, labels read by screen readers,
 * tooltips, alt text, disabled or invisible elements); `shown`: the rest.
 */
export function keysOnScreen(): { shown: Set<string>; hidden: Set<string> } {
  const shown = new Set<string>();
  const hidden = new Set<string>();
  for (const el of document.querySelectorAll(`[${MARK}]`)) {
    if (el.closest(UI_SELECTOR)) continue;
    const invisible = el.closest(':disabled, [hidden], [aria-hidden="true"]') !== null || el.getClientRects().length === 0;
    for (const k of attrKeys(el)) hidden.add(k);
    for (const k of textKeys(el)) (invisible ? hidden : shown).add(k);
  }
  for (const k of shown) hidden.delete(k);
  return { shown, hidden };
}
