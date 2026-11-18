// Live text: the runtime every transformed module imports (as `virtual:lore-copy`, LIVE_TEXT_SPEC 4, 5).
//
// The build transform (apps/web/vite/copyPlugin.ts) turns every static UI text into a call here:
//   __t(key, default, flags)              a plain string (attributes, props, confirm(), string children)
//   __tm(key, default, values, flags)     a message with {placeholders} (and <em>… tags in node mode)
//   __tl(keys, defaults, flags)           a string array whose items are read at use time
//   __useCopy()                           first statement of every component: re-render on a change
//   __copyTick()                          appended to useMemo deps so memoized words recompute
// Flags: 1 = plain (never marked in edit mode), 2 = node mode (__tm may return a keyed array).
//
// Lookup: the owner's unpublished edit, else the published override, else the default. An override that
// doesn't fit its default (placeholders, tags, characters) renders the default and is listed as broken.
// Override text only ever becomes React text or createElement() for a few inline tags: never HTML.
//
// Imports `#shared/copy`, never `#shared`: the transformed vocabulary.ts imports this module.
import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react';
import type { CopyState } from '#shared';
import {
  checkOverride,
  hashText,
  MARKER_RE,
  parseMessage,
  splitEdges,
  stripMarkers as stripMarkerTags,
  type CopyKind,
  type CopyProblem,
  type MessageNode,
} from '#shared/copy';
import { CACHE_KEY, draftKey, isCrashed, readCache, readDrafts, writeDrafts } from './cache.ts';
import type { Pending } from './types.ts';

export type { Pending };

// ------------------------------------------------------------------ edit markers (owner's edit mode)
// U+2063, the key's registry index in base 4 (U+200C U+2060 U+2061 U+2062), U+2064. Never U+200B (a line
// break chance) or U+200D (joins emoji). Only while editing, never with the plain flag.
const OPEN = '\u2063';
const DIGITS = '\u200C\u2060\u2061\u2062';

function encodeIndex(i: number): string {
  let s = '';
  do {
    s = DIGITS[i % 4]! + s;
    i = Math.floor(i / 4);
  } while (i > 0);
  return `${OPEN}${s}\u2064`;
}

// ------------------------------------------------------------------ the store (one per page)

interface Seen {
  /** The default from the code (core: edge whitespace off). */
  d: string;
  /** 's' as soon as one use is a string position. */
  kind: CopyKind;
  /** Placeholder names (the keys of __tm's values). */
  names: readonly string[];
  /** The default parsed (messages only). */
  nodes?: MessageNode[];
  /** Last time it was asked for (only while the owner's drafts are open: "Recently shown"). */
  last: number;
  /** `d` came from the code (__t/__tm). A server message seen first may only know its published words. */
  code: boolean;
}

interface Memo {
  text: string;
  nodes: MessageNode[] | null;
  problem: CopyProblem | null;
}

interface Store {
  version: string | null;
  published: Map<string, string>;
  /** Default text -> key (null when two keys share the words); filled as keys are used. For serverCopy. */
  defaults: Map<string, string | null>;
  /** Published words of server and word-list texts -> key (null when shared). Built when first needed. */
  sent: Map<string, string | null> | null;
  pending: Map<string, Pending>;
  draftsUser: string | null;
  editing: boolean;
  /** Anything to do at all (else __t returns the default untouched). */
  live: boolean;
  tick: number;
  listeners: Set<() => void>;
  keys: string[];
  index: Map<string, number>;
  tags: string[];
  seen: Map<string, Seen>;
  memo: Map<string, Memo>;
  broken: Map<string, CopyProblem>;
  listening: boolean;
}

function createStore(): Store {
  const cached = isCrashed() ? null : readCache();
  const s: Store = {
    version: cached?.version ?? null,
    published: new Map(Object.entries(cached?.texts ?? {})),
    defaults: new Map(),
    sent: null,
    pending: new Map(),
    draftsUser: null,
    editing: false,
    live: false,
    tick: 0,
    listeners: new Set(),
    keys: [],
    index: new Map(),
    tags: [],
    seen: new Map(),
    memo: new Map(),
    broken: new Map(),
    listening: false,
  };
  s.live = s.published.size > 0;
  return s;
}

// One store even if this module is evaluated twice (a Windows path spelled two ways in dev, HMR).
const G = globalThis as typeof globalThis & { __loreCopy?: Store };
if (G.__loreCopy && import.meta.env.DEV) console.warn('[lore-copy] runtime loaded twice; reusing the first store');
const S: Store = (G.__loreCopy ??= createStore());

function refresh(): void {
  S.live = S.editing || S.draftsUser !== null || S.published.size > 0 || S.pending.size > 0;
}

function bump(): void {
  S.tick++;
  for (const fn of [...S.listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  S.listeners.add(fn);
  return () => S.listeners.delete(fn);
}

function getTick(): number {
  return S.tick;
}

// ------------------------------------------------------------------ lookup

const NONE: readonly string[] = [];

function isEdgeSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

function edges(d: string): { lead: string; core: string; trail: string } {
  if (!d || (!isEdgeSpace(d.charCodeAt(0)) && !isEdgeSpace(d.charCodeAt(d.length - 1)))) {
    return { lead: '', core: d, trail: '' };
  }
  return splitEdges(d);
}

function note(key: string, core: string, kind: CopyKind, names: readonly string[], code: boolean): Seen {
  let s = S.seen.get(key);
  if (!s || (code && !s.code)) {
    // First use, or the code's own default for a key a server message showed first (in published words).
    s = s
      ? Object.assign(s, { d: core, code: true, nodes: undefined, names: names.length > s.names.length ? names : s.names })
      : { d: core, kind, names, last: 0, code };
    S.seen.set(key, s);
    if (code) {
      const prev = S.defaults.get(core);
      S.defaults.set(core, prev === undefined || prev === key ? key : null);
    }
  } else {
    if (kind === 's') s.kind = 's';
    if (names.length > s.names.length) {
      s.names = names;
      s.nodes = undefined;
    }
  }
  if (S.draftsUser) s.last = Date.now();
  return s;
}

/** The words to show instead of the default, or null for the default. */
function override(key: string): string | null {
  const p = S.pending.get(key);
  if (p) return p.text;
  return S.published.get(key) ?? null;
}

function resolve(key: string, text: string, seen: Seen, kind: CopyKind): Memo {
  const id = kind + key;
  const hit = S.memo.get(id);
  if (hit && hit.text === text) return hit;
  let problem = checkOverride(text, seen.d, kind);
  let nodes: MessageNode[] | null = null;
  if (!problem) {
    const parsed = parseMessage(text, { names: seen.names, tags: kind === 'n' });
    if (parsed.ok) nodes = parsed.message.nodes;
    else problem = parsed.problem;
  }
  const memo: Memo = { text, nodes, problem };
  S.memo.set(id, memo);
  if (problem) S.broken.set(key, problem);
  else S.broken.delete(key);
  return memo;
}

function markFor(key: string, flags: number): string {
  if (!S.editing || flags & 1) return '';
  let i = S.index.get(key);
  if (i === undefined) {
    i = S.keys.length;
    S.keys.push(key);
    S.index.set(key, i);
  }
  return (S.tags[i] ??= encodeIndex(i));
}

function defaultNodes(seen: Seen): MessageNode[] {
  if (!seen.nodes) {
    const parsed = parseMessage(seen.d, { names: seen.names, tags: true });
    seen.nodes = parsed.ok ? parsed.message.nodes : [{ type: 'text', value: seen.d }];
  }
  return seen.nodes;
}

/** As React shows a value: null, undefined and booleans are nothing. */
function show(v: unknown): string {
  return v === null || v === undefined || typeof v === 'boolean' ? '' : String(v);
}

function toText(nodes: readonly MessageNode[], v: Record<string, unknown>): string {
  let s = '';
  for (const n of nodes) {
    if (n.type === 'text') s += n.value;
    else if (n.type === 'ph') s += show(v[n.name]);
    else if (n.type === 'br') s += '\n';
    else s += toText(n.children, v);
  }
  return s;
}

function build(nodes: readonly MessageNode[], v: Record<string, unknown>, mark: string, out: ReactNode[], prefix: string) {
  let g = 0;
  for (const n of nodes) {
    if (n.type === 'text') out.push(n.value + mark);
    // Placeholders keep one key wherever an override moves them, so an <input> inside keeps focus and value.
    else if (n.type === 'ph') out.push(createElement(Fragment, { key: `p:${n.name}` }, v[n.name] as ReactNode));
    else if (n.type === 'br') out.push(createElement('br', { key: `${prefix}g${g++}` }));
    else {
      const kids: ReactNode[] = [];
      build(n.children, v, mark, kids, `${prefix}g${g}.`);
      out.push(createElement(n.tag, { key: `${prefix}g${g++}` }, ...kids));
    }
  }
}

// ------------------------------------------------------------------ what the transform calls

/** A plain string. Flags: 1 = plain (never marked). */
export function __t(key: string, d: string, flags = 0): string {
  if (!S.live) return d;
  const { lead, core, trail } = edges(d);
  const seen = note(key, core, 's', NONE, true);
  let text = core;
  const o = override(key);
  if (o !== null && o !== core && !resolve(key, o, seen, 's').problem) text = o;
  return lead + text + markFor(key, flags) + trail;
}

/**
 * A message with `{placeholders}`. String mode (flag 2 off) always returns a string. Node mode (flag 2)
 * returns a string when the words have no placeholders or tags, otherwise a keyed array (never a
 * Fragment): text parts as strings, each placeholder as `<Fragment key="p:name">`, tags rebuilt with
 * createElement. Flag 1 = plain.
 */
export function __tm(key: string, d: string, v: Record<string, unknown>, flags = 0): string | ReactNode[] {
  const node = (flags & 2) !== 0;
  const kind: CopyKind = node ? 'n' : 's';
  const { lead, core, trail } = edges(d);
  const seen = note(key, core, kind, Object.keys(v), true);
  let nodes = defaultNodes(seen);
  if (S.live) {
    const o = override(key);
    if (o !== null && o !== core) {
      const m = resolve(key, o, seen, kind);
      if (m.nodes) nodes = m.nodes;
    }
  }
  const mark = markFor(key, flags);
  if (!node) return lead + toText(nodes, v) + mark + trail;
  if (nodes.every((n) => n.type === 'text')) return lead + toText(nodes, v) + (nodes.length ? mark : '') + trail;
  const out: ReactNode[] = [];
  if (lead) out.push(lead);
  build(nodes, v, mark, out, '');
  if (trail) out.push(trail);
  return out;
}

/** A list of words whose items are read when used (`.map`, `.slice`, spread and `[i]` all see live words). */
export function __tl(keys: string[], defaults: string[], flags = 0): string[] {
  const list: string[] = new Array<string>(defaults.length);
  for (let i = 0; i < defaults.length; i++) {
    Object.defineProperty(list, i, { enumerable: true, configurable: true, get: () => __t(keys[i]!, defaults[i]!, flags) });
  }
  return list;
}

/** Re-renders the calling component whenever the words change (published, drafts, edit mode). */
export function __useCopy(): void {
  useSyncExternalStore(subscribe, getTick, getTick);
}

/** A number that changes whenever the words do (a plain read, not a hook). */
export function __copyTick(): number {
  return S.tick;
}

/** Which server or word-list text these published words are (the server sends static messages in them). */
function sentKey(words: string): string | null | undefined {
  if (!S.sent) {
    const sent = new Map<string, string | null>();
    // Server keys first, as the server looks them up (lib/copy.ts resolve): srv#, then the word list.
    for (const scope of ['srv#', 'shared/vocabulary#']) {
      const mine = new Map<string, string | null>();
      for (const [k, t] of S.published) if (k.startsWith(scope)) mine.set(t, mine.has(t) ? null : k);
      for (const [t, k] of mine) if (!sent.has(t)) sent.set(t, k);
    }
    S.sent = sent;
  }
  return S.sent.get(words);
}

/**
 * A message from the server (ApiError). Only static messages are keys (`srv#<hash>`, from the build's
 * scan of apps/api); words the web code also uses (a vocabulary line) follow that text's edit too.
 * The server already says a static message in the owner's published words (app.ts `say`), so a message
 * is also looked up by those words: edit mode then marks the right text and the owner's drafts show.
 */
export function serverCopy(message: string): string {
  if (!S.live || typeof message !== 'string' || !message) return message;
  const { lead, core, trail } = edges(message);
  if (!core) return message;
  const own = `srv#${hashText(core.normalize('NFC'))}`;
  const key = S.pending.has(own) || S.published.has(own) ? own : (sentKey(core) ?? S.defaults.get(core) ?? own);
  const p = S.pending.get(key);
  const seen = note(key, p?.original ?? core, 's', NONE, false);
  // A draft "back to the original" shows the original, which the server no longer sends.
  const o = p ? (p.text ?? p.original) : (S.published.get(key) ?? null);
  let text = core;
  if (o !== null && o !== core && !resolve(key, o, seen, 's').problem) text = o;
  return lead + text + markFor(key, 0) + trail;
}

/** Removes edit-marker tags (whole tags only; a real ZWNJ or ZWJ stays). */
export function stripMarkers(s: string): string {
  return stripMarkerTags(s);
}

// ------------------------------------------------------------------ the store's API (sync, gate, editor)

export interface MarkedSegment {
  key: string;
  /** The marked words are text.slice(start, end); the marker follows at `end`. */
  start: number;
  end: number;
}

function persist(): void {
  if (S.draftsUser) writeDrafts(S.draftsUser, S.pending);
}

function setPendingRaw(key: string, p: Pending | null): void {
  if (p) S.pending.set(key, p);
  else S.pending.delete(key);
}

export const copyStore = {
  subscribe,
  getTick,

  version: (): string | null => S.version,
  published: (): ReadonlyMap<string, string> => S.published,
  pending: (): ReadonlyMap<string, Pending> => S.pending,
  isEditing: (): boolean => S.editing,
  draftsUser: (): string | null => S.draftsUser,
  /** Published or unpublished words on this device (the crash guard acts only then). */
  hasLiveCopy: (): boolean => S.published.size > 0 || S.pending.size > 0,

  /** New published words (sync.ts, after a publish or undo). Already validated by the caller. */
  apply(state: CopyState): void {
    S.version = state.version;
    S.published = new Map(Object.entries(state.texts));
    S.sent = null;
    S.memo.clear();
    S.broken.clear();
    refresh();
    bump();
  },

  /** The owner gate confirmed the owner: show his unpublished edits (and start "Recently shown"). */
  openDrafts(userId: string): void {
    if (S.draftsUser === userId) return;
    S.draftsUser = userId;
    S.pending = new Map(readDrafts(userId));
    S.memo.clear();
    refresh();
    bump();
  },

  /** Signed out, someone else, or not the owner: unpublished words leave the screen (they stay stored). */
  closeDrafts(): void {
    if (!S.draftsUser && !S.pending.size && !S.editing) return;
    S.draftsUser = null;
    S.pending = new Map();
    S.editing = false;
    refresh();
    bump();
  },

  /** One unpublished edit (null removes it). Only while the owner's drafts are open. */
  setPending(key: string, p: Pending | null): void {
    if (!S.draftsUser) return;
    setPendingRaw(key, p);
    persist();
    refresh();
    bump();
  },

  setPendingMany(entries: Iterable<[string, Pending | null]>): void {
    if (!S.draftsUser) return;
    for (const [key, p] of entries) setPendingRaw(key, p);
    persist();
    refresh();
    bump();
  },

  /** Throws away unpublished edits (all, or these keys). */
  discardPending(keys?: Iterable<string>): void {
    if (!S.draftsUser) return;
    if (keys) for (const k of keys) S.pending.delete(k);
    else S.pending.clear();
    persist();
    refresh();
    bump();
  },

  /** After a publish: drops the edits that went live (unless they were changed again meanwhile). */
  settle(sent: Iterable<[string, Pending]>): void {
    if (!S.draftsUser) return;
    for (const [key, p] of sent) {
      const now = S.pending.get(key);
      if (now && now.text === p.text) S.pending.delete(key);
    }
    persist();
    refresh();
    bump();
  },

  /** Edit mode: markers on texts and taps open the editor. Only for the owner (drafts open). */
  setEditing(on: boolean): void {
    const next = on && S.draftsUser !== null;
    if (next === S.editing) return;
    S.editing = next;
    refresh();
    bump();
  },

  /** What the runtime knows about a key from using it on this device. */
  info(key: string): { d: string; kind: CopyKind; names: readonly string[] } | undefined {
    const s = S.seen.get(key);
    return s && { d: s.d, kind: s.kind, names: s.names };
  },

  /** The words a key shows now: the owner's draft, else the published text, else null (the default). */
  current(key: string): { text: string | null; source: 'pending' | 'published' | 'default' } {
    const p = S.pending.get(key);
    if (p) return { text: p.text, source: p.text === null ? 'default' : 'pending' };
    const t = S.published.get(key);
    return t === undefined ? { text: null, source: 'default' } : { text: t, source: 'published' };
  },

  /** Why an override is not shown (it doesn't fit its default), if it isn't. */
  problem: (key: string): CopyProblem | undefined => S.broken.get(key),
  brokenKeys: (): ReadonlyMap<string, CopyProblem> => S.broken,

  /** Keys used in the last `ms` (only tracked while the owner's drafts are open). Newest first. */
  recent(ms = 120_000): string[] {
    const since = Date.now() - ms;
    return [...S.seen]
      .filter(([, s]) => s.last >= since)
      .sort((a, b) => b[1].last - a[1].last)
      .map(([k]) => k);
  },

  /** The marked words in a DOM text or attribute value, and their keys. */
  decode(text: string | null | undefined): MarkedSegment[] {
    const out: MarkedSegment[] = [];
    if (!text || text.indexOf(OPEN) === -1) return out;
    let prev = 0;
    for (const m of text.matchAll(MARKER_RE)) {
      let i = 0;
      for (const ch of m[0].slice(1, -1)) i = i * 4 + DIGITS.indexOf(ch);
      const key = S.keys[i];
      if (key && m[0].length > 2 && m.index > prev) out.push({ key, start: prev, end: m.index });
      prev = m.index + m[0].length;
    }
    return out;
  },
};

// Other tabs: a newer published state they fetched, or the owner's drafts changed there.
if (typeof window !== 'undefined' && !S.listening) {
  S.listening = true;
  window.addEventListener('storage', (e) => {
    if (e.key === CACHE_KEY) {
      const cached = isCrashed() ? null : readCache();
      if (cached && cached.version !== S.version) copyStore.apply(cached);
    } else if (S.draftsUser && e.key === draftKey(S.draftsUser)) {
      S.pending = new Map(readDrafts(S.draftsUser));
      refresh();
      bump();
    }
  });
}

// A change to this file reloads the page rather than starting a second store under live components.
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());
