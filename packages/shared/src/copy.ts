// Live text: the words the owner can change in the app and publish (docs/ARCHITECTURE.md § Live text).
//
// One implementation of keys, message syntax and override checks, shared by the build plugin
// (apps/web/vite), the web runtime (apps/web/src/lib/copy) and the API (apps/api/src/lib/copy.ts).
// Imports nothing: the web runtime reaches it as `#shared/copy`, because the transformed
// vocabulary.ts imports the runtime and `#shared` would make a cycle.

// ---------------------------------------------------------------------------
// Keys

/** `<scope>#<hash8>`: scope is a web source path (`pages/Home`), `shared/vocabulary`, or `srv`. */
export const COPY_KEY_RE = /^(?:[A-Za-z0-9][A-Za-z0-9_./-]{0,99}|srv)#[0-9a-f]{8}$/;

/** Server messages (static `badRequest(...)` texts, notification templates) share one scope. */
export const SERVER_SCOPE = 'srv';
/** Where vocabulary.ts strings live in the catalog. */
export const VOCABULARY_SCOPE = 'shared/vocabulary';

/** At most this many edited texts are kept and sent to every app. */
export const MAX_COPY_OVERRIDES = 2000;
/** One publish: at most this many texts, and this many characters across them. */
export const MAX_COPY_BATCH = 300;
export const MAX_COPY_BATCH_CHARS = 300_000;
/** Publishes (and undos) one owner may make in an hour. */
export const COPY_PUBLISHES_PER_HOUR = 20;
/** The longest text an override may be (and never more than max(4,000, 2 × the original)). */
export const MAX_COPY_TEXT = 8000;

/** FNV-1a, 32 bit, over UTF-16 code units: 8 lowercase hex digits. Same in plugin, runtime and server. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Splits off edge whitespace: ASCII space, tab, CR and LF only (never NBSP, so not `trim()`).
 * The core is what keys hash and what the owner edits; the edges are re-applied around an override.
 */
export function splitEdges(text: string): { lead: string; core: string; trail: string } {
  const m = /^([ \t\r\n]*)([\s\S]*?)([ \t\r\n]*)$/.exec(text);
  return m ? { lead: m[1]!, core: m[2]!, trail: m[3]! } : { lead: '', core: text, trail: '' };
}

/** The editable form of a default: NFC, edges off. */
export function copyCore(text: string): string {
  return splitEdges(text.normalize('NFC')).core;
}

/** The key of a default text in a scope. */
export function copyKey(scope: string, text: string): string {
  return `${scope}#${hashText(copyCore(text))}`;
}

/** The hash part of a key (`pages/Home#1a2b3c4d` → `1a2b3c4d`). */
export function keyHash(key: string): string {
  return key.slice(key.lastIndexOf('#') + 1);
}

/** The scope part of a key (`pages/Home#1a2b3c4d` → `pages/Home`). */
export function keyScope(key: string): string {
  return key.slice(0, key.lastIndexOf('#'));
}

// ---------------------------------------------------------------------------
// Characters

/**
 * Never allowed in an override: anything invisible that could carry hidden words into the Loracle's
 * prompts or a code session ("Copy for Claude", copy:check). C0/C1 controls except LF (LF is checked
 * separately) and DEL; the Arabic letter mark U+061C; zero-width space U+200B; LRM/RLM U+200E–200F;
 * line and paragraph separators U+2028–2029 (browsers break lines on them); bidi controls
 * U+202A–202E; U+2060–206F (word joiner, the invisible operators used as edit markers, bidi
 * isolates, deprecated format controls); BOM U+FEFF; interlinear annotations U+FFF9–FFFB; tag
 * characters U+E0000–E007F (invisible ASCII) and variation selectors U+E0100–E01EF (as UTF-16:
 * U+DB40 then U+DC00–DDEF). ZWNJ (U+200C) and ZWJ (U+200D) are allowed: real scripts and emoji
 * such as 👨‍👩‍👧 need them. This also refuses the England, Scotland and Wales flags (built from tags).
 * Escapes only and no `u` flag: old WebViews.
 */
export const COPY_FORBIDDEN =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDDEF]/;

/** A lone surrogate half (would not survive JSON round trips everywhere). No lookbehind: old WebViews. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
      else return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * The invisible tag the web runtime appends in the owner's edit mode: U+2063, base-4 digits in
 * U+200C U+2060 U+2061 U+2062, then U+2064. Matches whole tags only, so a lone ZWNJ is never removed.
 * Global: use with `replace` (or reset `lastIndex`), never with a bare `.test` in a loop.
 */
export const MARKER_RE = /\u2063[\u200C\u2060-\u2062]*\u2064/g;

/** Removes edit-marker tags (and only them). */
export function stripMarkers(s: string): string {
  return s.indexOf('\u2063') === -1 ? s : s.replace(MARKER_RE, '');
}

// ---------------------------------------------------------------------------
// Messages: `{name}` placeholders and a few inline tags

/** Inline tags an override may use on texts shown as page content (kind `n`). `br` is the only void tag. */
export const COPY_TAGS = ['em', 'strong', 'b', 'i', 'u', 'small', 'mark'] as const;
export type CopyTag = (typeof COPY_TAGS)[number];
const TAG_SET: ReadonlySet<string> = new Set(COPY_TAGS);

/** `s`: shown as a string (attribute, prop, confirm, server message). `n`: page content, may hold tags. */
export type CopyKind = 's' | 'n';

export type MessageNode =
  | { type: 'text'; value: string }
  | { type: 'ph'; name: string }
  | { type: 'tag'; tag: CopyTag; children: MessageNode[] }
  | { type: 'br' };

export interface ParsedMessage {
  nodes: MessageNode[];
  /** Placeholder names in order of appearance, repeats included. */
  placeholders: string[];
  /** Whether any tag or line break is used. */
  tags: boolean;
}

export type CopyProblemCode =
  | 'empty'
  | 'too_long'
  | 'invisible'
  | 'newline'
  | 'url'
  | 'tags'
  | 'unbalanced'
  | 'placeholders';

export interface CopyProblem {
  code: CopyProblemCode;
  /** placeholders: the placeholder concerned. */
  name?: string;
  /** placeholders: true when it is missing, false when it is there too often. */
  missing?: boolean;
  /** unbalanced: the tag concerned. */
  tag?: string;
}

export type ParseResult = { ok: true; message: ParsedMessage } | { ok: false; problem: CopyProblem };

/** A placeholder name: an identifier (`displayName`, `Link`, `__LORE_VERSION__`) or an index (`0`). */
export const PLACEHOLDER_NAME_RE = /^(?:[A-Za-z_$][\w$]*|\d+)$/;
const TOKEN = /\{([A-Za-z_$][\w$]*|\d+)\}|<(\/?)([A-Za-z]+)\s*(\/?)>/g;

/**
 * Parses a message. `names`: the placeholder names that count as `{name}` (others are literal
 * text); omitted, every `{identifier}` is one (a default's own placeholders). `tags: false`
 * refuses inline tags (string-kind texts). Anything else (`{`, `<`, `&`) is literal text: no
 * entities, no HTML.
 */
export function parseMessage(text: string, opts: { names?: Iterable<string> | null; tags?: boolean } = {}): ParseResult {
  const names = opts.names ? new Set(opts.names) : null;
  const allowTags = opts.tags !== false;
  const root: MessageNode[] = [];
  const stack: { tag: CopyTag; children: MessageNode[] }[] = [];
  const placeholders: string[] = [];
  let tags = false;
  const out = () => stack.at(-1)?.children ?? root;
  const pushText = (value: string) => {
    if (!value) return;
    const list = out();
    const last = list.at(-1);
    if (last?.type === 'text') last.value += value;
    else list.push({ type: 'text', value });
  };

  let at = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const [whole, name, closing, rawTag, selfClosing] = m;
    pushText(text.slice(at, m.index));
    at = m.index + whole.length;
    if (name !== undefined) {
      if (names && !names.has(name)) {
        pushText(whole);
      } else {
        out().push({ type: 'ph', name });
        placeholders.push(name);
      }
      continue;
    }
    const tag = rawTag!.toLowerCase();
    if (tag === 'br' && !closing) {
      if (!allowTags) return { ok: false, problem: { code: 'tags', tag } };
      out().push({ type: 'br' });
      tags = true;
      continue;
    }
    if (!TAG_SET.has(tag) || selfClosing) {
      pushText(whole);
      continue;
    }
    if (!allowTags) return { ok: false, problem: { code: 'tags', tag } };
    tags = true;
    if (!closing) {
      const node = { type: 'tag' as const, tag: tag as CopyTag, children: [] as MessageNode[] };
      out().push(node);
      stack.push(node);
    } else {
      const open = stack.at(-1);
      if (!open || open.tag !== tag) return { ok: false, problem: { code: 'unbalanced', tag: open?.tag ?? tag } };
      stack.pop();
    }
  }
  pushText(text.slice(at));
  const unclosed = stack.at(-1);
  if (unclosed) return { ok: false, problem: { code: 'unbalanced', tag: unclosed.tag } };
  return { ok: true, message: { nodes: root, placeholders, tags } };
}

export interface MessageShape {
  /** Placeholder names, sorted, repeats included (a multiset). */
  placeholders: string[];
  /** Tags used (`br` included), sorted, each once. */
  tags: string[];
}

/** What an override of this default must keep: its placeholders (and which tags it already uses). */
export function messageShape(text: string): MessageShape | null {
  const parsed = parseMessage(text);
  if (!parsed.ok) return null;
  const tags = new Set<string>();
  const walk = (nodes: MessageNode[]) => {
    for (const n of nodes) {
      if (n.type === 'br') tags.add('br');
      if (n.type === 'tag') {
        tags.add(n.tag);
        walk(n.children);
      }
    }
  };
  walk(parsed.message.nodes);
  return { placeholders: [...parsed.message.placeholders].sort(), tags: [...tags].sort() };
}

/** The `{name}` placeholders a default holds, each once. */
export function placeholderNames(text: string): string[] {
  return [...new Set(messageShape(text)?.placeholders ?? [])];
}

const URL_SCHEME = /^\s*(javascript|data|vbscript)\s*:/i;

/**
 * Checks an override against the default it replaces. Returns the first problem, or null when the
 * override may be shown. Used by the server before publishing, by the editor while typing and by
 * the runtime before rendering (a broken override renders the default).
 */
export function checkOverride(text: string, original: string, kind: CopyKind): CopyProblem | null {
  if (!/\S/.test(text)) return { code: 'empty' };
  if (text.length > Math.min(MAX_COPY_TEXT, Math.max(4000, 2 * original.length))) return { code: 'too_long' };
  if (COPY_FORBIDDEN.test(text) || hasLoneSurrogate(text)) return { code: 'invisible' };
  if (text.includes('\n') && !original.includes('\n')) return { code: 'newline' };
  const scheme = URL_SCHEME.exec(text);
  if (scheme && URL_SCHEME.exec(original)?.[1]?.toLowerCase() !== scheme[1]!.toLowerCase()) return { code: 'url' };

  const wanted = messageShape(original)?.placeholders ?? [];
  const parsed = parseMessage(text, { names: wanted, tags: kind === 'n' });
  if (!parsed.ok) return parsed.problem;
  const got = [...parsed.message.placeholders].sort();
  const count = (list: string[], name: string) => list.filter((n) => n === name).length;
  for (const name of new Set([...wanted, ...got])) {
    const need = count(wanted, name);
    const have = count(got, name);
    if (have < need) return { code: 'placeholders', name, missing: true };
    if (have > need) return { code: 'placeholders', name, missing: false };
  }
  return null;
}

/** The kind to check against when no catalog says: tags only where the default already has some. */
export function kindFromOriginal(original: string): CopyKind {
  return (messageShape(original)?.tags.length ?? 0) > 0 ? 'n' : 's';
}

/** Plain words for a problem, for the editor and the server's 400s. */
export function copyProblemText(p: CopyProblem): string {
  switch (p.code) {
    case 'empty':
      return 'Can’t be empty.';
    case 'too_long':
      return 'Too long.';
    case 'invisible':
      return 'Invisible or control characters aren’t allowed.';
    case 'newline':
      return 'One line only.';
    case 'url':
      return 'Can’t start with javascript:, data: or vbscript:.';
    case 'tags':
      return 'Plain words only here: no emphasis or line breaks.';
    case 'unbalanced':
      return `Close the <${p.tag ?? 'em'}> you opened.`;
    case 'placeholders':
      return p.missing === false
        ? `Use {${p.name}} as often as the original does.`
        : `Keep {${p.name}} in the text.`;
  }
}

/**
 * The form an override is stored in: NFC, CRLF as LF, edge whitespace off (the default's own
 * edges are re-applied when it is shown).
 */
export function normalizeOverride(text: string): string {
  return splitEdges(text.normalize('NFC').replace(/\r\n?/g, '\n')).core;
}

// ---------------------------------------------------------------------------
// copy(): the escape hatch for text the build plugin can't find by itself

export type CopyVars = Record<string, unknown>;

/** Fills `{name}` holes from `vars` (as React shows values: null/undefined/booleans → ""). Unknown holes stay. */
export function fillHoles(text: string, vars: CopyVars): string {
  return text.replace(/\{([A-Za-z_$][\w$]*|\d+)\}/g, (hole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? show(vars[name]) : hole,
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  return String(v);
}

/** Looks up an override for a default's core text; undefined = keep the default. */
export type CopyResolver = (core: string) => string | undefined;

/** Installed resolvers; the last one wins (tests may run several apps in one process). */
const resolvers: CopyResolver[] = [];

/**
 * Where `copy()` finds overrides outside the build plugin. The API installs one that reads its
 * published snapshot (server messages and notification titles, key `srv#<hash>`). Returns a
 * function that removes it again.
 */
export function installCopyResolver(next: CopyResolver): () => void {
  resolvers.push(next);
  return () => {
    const at = resolvers.lastIndexOf(next);
    if (at !== -1) resolvers.splice(at, 1);
  };
}

function copyText(text: string, vars?: CopyVars): string {
  let out = text;
  const resolver = resolvers.at(-1);
  if (resolver) {
    const { lead, core, trail } = splitEdges(text.normalize('NFC'));
    const found = core ? resolver(core) : undefined;
    if (found !== undefined) out = lead + found + trail;
  }
  return vars ? fillHoles(out, vars) : out;
}

export interface CopyFunction {
  /** An editable text with `{holes}` filled from `vars`. */
  (text: string, vars?: CopyVars): string;
  /** Same, never marked in edit mode: for strings that leave the screen (notification titles, data). */
  plain(text: string, vars?: CopyVars): string;
  /** A list of words, each editable on its own. */
  list(words: readonly string[]): string[];
}

/**
 * Marks a text as editable live. In web code the build plugin rewrites calls with literal
 * arguments (keyed by file); elsewhere (the API, tests) it returns the text with holes filled,
 * through the installed resolver if any (`srv#<hash>` on the server).
 */
export const copy: CopyFunction = Object.assign((text: string, vars?: CopyVars) => copyText(text, vars), {
  plain: (text: string, vars?: CopyVars) => copyText(text, vars),
  list: (words: readonly string[]) => words.map((w) => copyText(w)),
});
