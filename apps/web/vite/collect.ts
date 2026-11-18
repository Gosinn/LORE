// The copy collector: finds every piece of static UI text in one source file, rewrites it into a
// runtime lookup (`__t`, `__tm`, `__tl` from `virtual:lore-copy`), and reports what it couldn't
// classify. Shared by the Vite plugin (copyPlugin.ts), the coverage test and `npm run copy:check`.
// Spec: LIVE_TEXT_SPEC.md section 4. Runs under Vite, Vitest and plain Node (erasable TS only).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
import { parseSync } from 'vite';
import {
  CODE_CALLS,
  CODE_KEYS,
  CODE_PROPS,
  INLINE_TAGS,
  LABEL_DOM_TAGS,
  LEGAL_PATH,
  NEVER_TABLES,
  PLAIN_PATHS,
  SINKS,
  SKIP_TAGS,
  STRING_ONLY_PARENTS,
  TABLE_NAMES,
  TEXT_DOM_ATTRS,
  TEXT_KEYS,
  TEXT_PROPS,
} from './copyNames.ts';
import { hashText } from '../../../packages/shared/src/copy.ts';
import { cleanJsxAttr, cleanJsxText, decodeEntities } from './jsxText.ts';

// ------------------------------------------------------------------------------------------ types

/** A loose ESTree node from oxc (`parseSync(..., { astType: 'ts' })`). Offsets are UTF-16. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export type CopyKind = 's' | 'n';

/** One place a text is used. Several occurrences can share a key (same words, same file). */
export interface Occurrence {
  key: string;
  /** The editable text: the rendered default, NFC, edge whitespace removed, canonical placeholders. */
  text: string;
  kind: CopyKind;
  /** Placeholder name -> source snippet (so the editor can show what `{0}` is). */
  ph?: Record<string, string>;
  /** "pages/Home.tsx:42" (web) or a repo-relative path (shared, server). */
  at: string;
  /** "Home › h2", "LORACLE_LINES.cast", "Server message". */
  ctx: string;
  legal?: boolean;
  plain?: boolean;
  /** The literal pieces as React renders them (tests only; never in the catalog). */
  parts?: string[];
}

export type IssueKind =
  | 'name' // a literal with letters under an attribute/prop/default name in no list (copyNames.ts)
  | 'prose' // a prose-like literal in a position the transform doesn't reach
  | 'pascal' // a PascalCase function called directly or passed as a value
  | 'key' // key= reads a text value
  | 'module-jsx' // module-level JSX with text (evaluated once)
  | 'memo-deps' // useMemo with non-literal deps
  | 'copy-arg' // copy() with non-literal arguments
  | 'entity' // an &…; the entity table doesn't know
  | 'table-mixed' // a text string inside a mixed array in a table
  | 'module-copy' // copy() at module level (warning only)
  | 'collision' // two texts, one key (build error)
  | 'syntax' // a default that would parse as message syntax (build error)
  | 'string-element' // an element placeholder where only strings work (build error)
  | 'parse'; // the file doesn't parse

export interface CopyIssue {
  kind: IssueKind;
  at: string;
  text: string;
  message: string;
}

export interface FileInfo {
  /** Key prefix: path under apps/web/src without extension, or "shared/vocabulary". */
  scope: string;
  /** Path shown in `at`. */
  display: string;
  /** Name used in contexts at module level ("Home", "vocabulary"). */
  screen: string;
  /** Every text in this file is legal / consent text (section 9). */
  legal: boolean;
}

export interface Analysis {
  s: MagicString;
  changed: boolean;
  occurrences: Occurrence[];
  /** Coverage failures (12.3). */
  issues: CopyIssue[];
  /** Worth knowing, never failing. */
  warnings: CopyIssue[];
  /** Build errors. */
  errors: CopyIssue[];
  /** Runtime names the output imports. */
  used: string[];
  /** JSX texts left alone on purpose (`copy:ignore`, `data-copy="off"`, `<code>`…): tests only. */
  skipped: string[];
}

export interface CatalogEntry {
  text: string;
  kind: CopyKind;
  ph?: Record<string, string>;
  at: string[];
  ctx: string;
  legal?: 1;
  plain?: 1;
}

export interface Catalog {
  build: string;
  keys: Record<string, CatalogEntry>;
}

// ---------------------------------------------------------------------------------- shared bits

export const RUNTIME_ID = 'virtual:lore-copy';

const slash = (p: string) => p.replace(/\\/g, '/');
/** Absolute, forward slashes, upper-case drive letter: one spelling per file on Windows and Linux. */
export function normAbs(p: string): string {
  return slash(path.resolve(p)).replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`);
}

export const REPO = normAbs(fileURLToPath(new URL('../../../', import.meta.url))).replace(/\/$/, '');
export const WEB_SRC = `${REPO}/apps/web/src`;
export const VOCABULARY = `${REPO}/packages/shared/src/vocabulary.ts`;
// vocabulary.ts: its signLine() sentences are written into roads by the server (copy(), srv# keys).
export const SERVER_SOURCES = [`${REPO}/apps/api/src`, `${REPO}/packages/shared/src/inputs.ts`, `${REPO}/packages/shared/src/vocabulary.ts`];

/** FNV-1a 32-bit (one function for the plugin, the runtime and the server). */
export { hashText };

/** Split ASCII edge whitespace (never NBSP) off a text: [lead, core, trail]. */
export function splitEdges(s: string): [string, string, string] {
  const lead = /^[ \t\r\n]*/.exec(s)![0];
  if (lead.length === s.length) return [s, '', ''];
  const trail = /[ \t\r\n]*$/.exec(s)![0];
  return [lead, s.slice(lead.length, s.length - trail.length), trail];
}

export function keyFor(scope: string, core: string): string {
  return `${scope}#${hashText(core.normalize('NFC'))}`;
}

/** Letters, numbers or pictographs: "has text" (4.5). */
export const HAS_TEXT = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;
const LETTER = /\p{L}/u;
const TAG_SYNTAX = /<\/?(?:em|strong|b|i|u|small|mark)>|<br\s*\/?>/;
/** A component's name: capitalised, not an ALL_CAPS constant (`A` and `PDFView` count; `NAV` doesn't). */
const PASCAL = /^[A-Z](?:$|[\w$]*[a-z])/;
const PH_NAME = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const COMPARE = new Set(['===', '!==', '==', '!=', 'in', 'instanceof']);
const TS_EXPR = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression']);
const SKIP_KEYS = new Set(['type', 'start', 'end', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeArguments', 'decorators', 'implements']);
const WRAPPERS = new Set(['memo', 'forwardRef']);
const VALUE_OK_CALLS = new Set(['lazy', 'memo', 'forwardRef', 'createElement', 'cloneElement', 'isValidElement']);

/**
 * Looks like words for people rather than code: a letter and a space, or a capitalised word.
 * URLs, paths, selectors, SVG path data and MIME types are code.
 */
export function proseLike(s: string): boolean {
  const t = s.trim();
  if (!LETTER.test(t)) return false;
  if (/^(?:https?:|mailto:|tel:|geo:|data:|blob:|\/|\.{1,2}\/|[#.][\w-]|var\(|url\(|rgba?\(|hsla?\(|calc\(|color-mix\()/.test(t)) return false;
  if (/^[MmLlHhVvCcSsQqTtAaZz][\d\s.,-]/.test(t) && /^[MmLlHhVvCcSsQqTtAaZz\d\s.,-]+$/.test(t)) return false;
  if (/^[\w-]+\/[\w.+-]+$/.test(t)) return false;
  return /\s/.test(t) || /^\p{Lu}\p{Ll}/u.test(t);
}

/** The string literals a ternary picks between (through parentheses and casts) that read as words. */
function wordBranches(n: N): N[] {
  if (!n) return [];
  if (n.type === 'ParenthesizedExpression' || TS_EXPR.has(n.type)) return wordBranches(n.expression);
  if (n.type !== 'ConditionalExpression') return [];
  const branch = (b: N): N[] => {
    if (!b) return [];
    if (b.type === 'ParenthesizedExpression' || TS_EXPR.has(b.type)) return branch(b.expression);
    if (b.type === 'ConditionalExpression') return wordBranches(b);
    // Code-shaped strings (class names, keys, paths) carry - _ . / # : or @.
    return b.type === 'Literal' && typeof b.value === 'string' && LETTER.test(b.value) && !/[-_./#:@]/.test(b.value) ? [b] : [];
  };
  return [...branch(n.consequent), ...branch(n.alternate)];
}

// ------------------------------------------------------------------------------- the analysis

interface Comp {
  name: string;
  fn: N;
  hasJsx: boolean;
  hasCopy: boolean;
}

interface Ctx {
  /** 0 = module level. */
  depth: number;
  comp: Comp | null;
  plain: boolean;
  legal: boolean;
  /** Catalog context override (table paths). */
  path: string | null;
  /** Component or file name, for contexts. */
  screen: string;
}

type Directive = 'ignore' | 'plain' | 'table';

interface Part {
  kind: 'text' | 'tag' | 'atom' | 'empty';
  node: N;
  text?: string;
  render?: string;
  inner?: string[];
  ignored?: boolean;
  plain?: boolean;
}

const lit = (v: string) => JSON.stringify(v);

/** Analyse one file. The returned MagicString holds the rewritten source. */
export function analyzeFile(code: string, info: FileInfo): Analysis {
  const lang = /\.tsx$/.test(info.display) || /\.tsx$/.test(info.scope) ? 'tsx' : info.display.endsWith('.ts') ? 'ts' : 'tsx';
  const s = new MagicString(code);
  const occurrences: Occurrence[] = [];
  const issues: CopyIssue[] = [];
  const warnings: CopyIssue[] = [];
  const errors: CopyIssue[] = [];
  const used = new Set<string>();
  const skipped: string[] = [];
  const result = (): Analysis => ({
    s,
    changed: s.hasChanged(),
    occurrences,
    issues,
    warnings,
    errors,
    used: [...used].sort(),
    skipped,
  });

  const parsed = parseSync(info.display, code, { lang, astType: 'ts' }) as unknown as { program: N; comments: N[]; errors: N[] };

  // Line numbers for `at`.
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const at = (pos: number) => `${info.display}:${lineOf(pos)}`;
  if (parsed.errors.length) {
    // The plugin leaves syntax errors to Vite (its overlay has the code frame); the coverage test and
    // copy:check report them with the real line.
    const first = parsed.errors[0];
    errors.push({ kind: 'parse', at: at(first?.labels?.[0]?.start ?? 0), text: '', message: String(first?.message ?? 'parse error') });
    return result();
  }
  const snippet = (n: N) => code.slice(n.start, n.end).replace(/\s+/g, ' ').slice(0, 80);
  const short = (t: string) => (t.length > 70 ? `${t.slice(0, 67)}…` : t);

  // `// copy:ignore|plain|table` annotations, by the offset of the node they precede.
  const annots = new Map<number, Directive>();
  const commentDirectives: { start: number; end: number; dir: Directive }[] = [];
  for (const c of parsed.comments) {
    const m = /^\s*\*?\s*copy:(ignore|plain|table)\b/.exec(c.value as string);
    if (!m) continue;
    const dir = m[1] as Directive;
    commentDirectives.push({ start: c.start, end: c.end, dir });
    let t = c.end;
    while (t < code.length && /[\s}]/.test(code[t]!)) t++;
    annots.set(t, dir);
  }
  const directiveIn = (n: N): Directive | null => commentDirectives.find((c) => c.start >= n.start && c.end <= n.end)?.dir ?? null;

  // Edits. Overwrites keep text inserted at their edges (contentOnly), so nesting composes.
  const replace = (start: number, end: number, text: string) => {
    if (start === end) s.appendLeft(start, text);
    else s.overwrite(start, end, text, { contentOnly: true });
  };

  const handled = new WeakSet<object>();
  const keyTexts = new Map<string, string>();
  const comps: Comp[] = [];
  const pascalFns = new Set<string>();
  const textParams = new Set<string>();
  const textArrays = new Set<string>();
  let copyImport: { decl: N; spec: N; local: string } | null = null;
  let copyRefs = 0;
  let copyRewrites = 0;

  const issue = (kind: IssueKind, pos: number, text: string, message: string) => issues.push({ kind, at: at(pos), text: short(text), message });
  const warn = (kind: IssueKind, pos: number, text: string, message: string) => warnings.push({ kind, at: at(pos), text: short(text), message });
  const fail = (kind: IssueKind, pos: number, text: string, message: string) => errors.push({ kind, at: at(pos), text: short(text), message });

  const markCopy = (ctx: Ctx) => {
    if (ctx.comp) ctx.comp.hasCopy = true;
  };

  /** Register one occurrence; returns its key. */
  const record = (
    ctx: Ctx,
    core: string,
    kind: CopyKind,
    where: string,
    pos: number,
    extra: { ph?: Record<string, string>; plain?: boolean; parts?: string[] } = {},
  ): string => {
    const text = core.normalize('NFC');
    const key = `${info.scope}#${hashText(text)}`;
    const prev = keyTexts.get(key);
    if (prev !== undefined && prev !== text) fail('collision', pos, text, `"${short(prev)}" and "${short(text)}" have the same key ${key}: reword one or mark it // copy:ignore`);
    keyTexts.set(key, text);
    const o: Occurrence = { key, text, kind, at: at(pos), ctx: ctx.path ?? `${ctx.screen} › ${where}` };
    if (extra.ph && Object.keys(extra.ph).length) o.ph = extra.ph;
    if (info.legal || ctx.legal) o.legal = true;
    if (ctx.plain || extra.plain) o.plain = true;
    if (extra.parts) o.parts = extra.parts;
    occurrences.push(o);
    markCopy(ctx);
    return key;
  };

  /** Note every JSX text under a node that is left alone on purpose. */
  const skip = (node: N): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) skip(n);
      return;
    }
    if (node.type === 'JSXText') {
      const t = cleanJsxText(decodeEntities(node.value) ?? node.value);
      if (t) skipped.push(t);
      return;
    }
    if (node.type === 'JSXExpressionContainer' && isStr(node.expression)) {
      skipped.push(node.expression.value);
      return;
    }
    for (const k in node) if (!SKIP_KEYS.has(k) && node[k] && typeof node[k] === 'object') skip(node[k]);
  };

  const enter = (node: N, ctx: Ctx): Ctx | null => {
    const d = annots.get(node.start);
    if (d === 'ignore') {
      skip(node);
      return null;
    }
    if (d === 'plain' && !ctx.plain) return { ...ctx, plain: true };
    return ctx;
  };

  // ------------------------------------------------------------------------- small AST helpers

  const unwrapTs = (n: N): N => {
    let x = n;
    while (x && (TS_EXPR.has(x.type) || x.type === 'ParenthesizedExpression')) x = x.expression;
    return x;
  };
  const unwrapAll = (n: N): N => {
    let x = n;
    while (x && (TS_EXPR.has(x.type) || x.type === 'ParenthesizedExpression' || x.type === 'ChainExpression')) x = x.expression;
    return x;
  };
  const isStr = (n: N) => n?.type === 'Literal' && typeof n.value === 'string';
  const isPlainTemplate = (n: N) => n?.type === 'TemplateLiteral' && n.expressions.length === 0 && n.quasis[0]?.value.cooked != null;
  const strValue = (n: N): string | null => (isStr(n) ? n.value : isPlainTemplate(n) ? n.quasis[0].value.cooked : null);
  const jsxName = (n: N): string => {
    if (n.type === 'JSXIdentifier') return n.name;
    if (n.type === 'JSXMemberExpression') return `${jsxName(n.object)}.${n.property.name}`;
    if (n.type === 'JSXNamespacedName') return `${n.namespace.name}:${n.name.name}`;
    return '?';
  };
  const attrName = (a: N): string => (a.name.type === 'JSXNamespacedName' ? `${a.name.namespace.name}:${a.name.name.name}` : a.name.name);
  const keyName = (p: N): string | null => {
    if (p.computed) return isStr(p.key) ? p.key.value : null;
    if (p.key.type === 'Identifier') return p.key.name;
    if (p.key.type === 'Literal') return String(p.key.value);
    return null;
  };
  const keySrc = (p: N) => (p.computed ? `[${code.slice(p.key.start, p.key.end)}]` : code.slice(p.key.start, p.key.end));
  const calleeName = (c: N): string | null => {
    const u = unwrapAll(c);
    if (!u) return null;
    if (u.type === 'Identifier') return u.name;
    if (u.type === 'MemberExpression' && !u.computed && u.property.type === 'Identifier') return u.property.name;
    return null;
  };
  const seqOpen = (n: N) => (n.type === 'SequenceExpression' ? '(' : '');
  const seqClose = (n: N) => (n.type === 'SequenceExpression' ? ')' : '');

  const phName = (node: N): string | null => {
    const n = unwrapAll(node);
    if (!n) return null;
    if (n.type === 'Identifier') return n.name;
    if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
      const p = n.property.name as string;
      if (p === 'length' || p === 'size') {
        const o = phName(n.object);
        return o ? `${o}Count` : null;
      }
      return p;
    }
    if (n.type === 'CallExpression') return phName(n.callee);
    if (n.type === 'JSXElement') return jsxName(n.openingElement.name).split('.').pop() ?? null;
    return null;
  };
  const nameAll = (nodes: N[]): string[] => {
    const taken = new Set<string>();
    let n = 0;
    return nodes.map((node) => {
      const base = phName(node);
      if (base === null || !PH_NAME.test(base)) {
        while (taken.has(String(n))) n++;
        const name = String(n++);
        taken.add(name);
        return name;
      }
      let name = base;
      for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
      taken.add(name);
      return name;
    });
  };
  /** A literal part that would read as message syntax: build error. */
  const syntaxClash = (texts: string[], names: string[]): string | null => {
    for (const t of texts) {
      if (TAG_SYNTAX.test(t)) return t;
      for (const nm of names) if (t.includes(`{${nm}}`)) return t;
    }
    return null;
  };

  // ------------------------------------------------------------------------------- emitters

  /** A string literal in string mode: the call text, or null when it holds no text. */
  const stringCall = (value: string, ctx: Ctx, where: string, pos: number): string | null => {
    if (!HAS_TEXT.test(value)) return null;
    const v = value.normalize('NFC');
    if (TAG_SYNTAX.test(v)) {
      fail('syntax', pos, v, 'Looks like an inline tag; reword it or mark it // copy:ignore');
      return null;
    }
    const [, core] = splitEdges(v);
    const key = record(ctx, core, 's', where, pos, { parts: [v] });
    used.add('__t');
    return `__t(${lit(key)}, ${lit(v)}${ctx.plain ? ', 1' : ''})`;
  };

  /** A template literal in string mode (rule 7). */
  const rewriteTemplate = (node: N, ctx: Ctx, where: string) => {
    handled.add(node);
    const quasis: (string | null)[] = node.quasis.map((q: N) => q.value.cooked);
    const exprs: N[] = node.expressions;
    if (quasis.some((q) => q == null) || !quasis.some((q) => HAS_TEXT.test(q!))) {
      for (const e of exprs) uiExpr(e, ctx, where);
      return;
    }
    const names = nameAll(exprs);
    const clash = syntaxClash(quasis as string[], names);
    if (clash !== null) {
      fail('syntax', node.start, clash, 'Text that reads as message syntax ({name} or an inline tag); reword it or mark it // copy:ignore');
      for (const e of exprs) uiExpr(e, ctx, where);
      return;
    }
    let msg = quasis[0]!;
    exprs.forEach((_e, i) => (msg += `{${names[i]}}${quasis[i + 1]}`));
    msg = msg.normalize('NFC');
    const [, core] = splitEdges(msg);
    const ph: Record<string, string> = {};
    exprs.forEach((e, i) => (ph[names[i]!] = snippet(e)));
    const key = record(ctx, core, 's', where, node.start, { ph, parts: quasis as string[] });
    const flags = ctx.plain ? 1 : 0;
    if (!exprs.length) {
      used.add('__t');
      replace(node.start, node.end, `__t(${lit(key)}, ${lit(msg)}${flags ? ', 1' : ''})`);
      return;
    }
    used.add('__tm');
    replace(node.start, exprs[0].start, `__tm(${lit(key)}, ${lit(msg)}, { ${lit(names[0]!)}: ${seqOpen(exprs[0])}`);
    for (let i = 1; i < exprs.length; i++) {
      replace(exprs[i - 1].end, exprs[i].start, `${seqClose(exprs[i - 1])}, ${lit(names[i]!)}: ${seqOpen(exprs[i])}`);
    }
    const last = exprs[exprs.length - 1];
    replace(last.end, node.end, `${seqClose(last)} }, ${flags})`);
    for (const e of exprs) uiExpr(e, ctx, where);
  };

  /** Would `uiExpr` rewrite anything in this expression? */
  const uiTextIn = (node: N): boolean => {
    const n = node && (TS_EXPR.has(node.type) || node.type === 'ParenthesizedExpression') ? unwrapTs(node) : node;
    if (!n) return false;
    switch (n.type) {
      case 'ConditionalExpression':
        return uiTextIn(n.consequent) || uiTextIn(n.alternate);
      case 'LogicalExpression':
        return uiTextIn(n.right);
      case 'Literal':
        return typeof n.value === 'string' && HAS_TEXT.test(n.value);
      case 'TemplateLiteral':
        return n.quasis.some((q: N) => q.value.cooked != null && HAS_TEXT.test(q.value.cooked)) || n.expressions.some(uiTextIn);
      default:
        return false;
    }
  };

  /** A position whose strings are shown (rules 2–6): rewrite every literal with text, string mode. */
  function uiExpr(node: N, ctx0: Ctx, where: string): void {
    if (!node) return;
    const ctx = enter(node, ctx0);
    if (!ctx) return;
    switch (node.type) {
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
        uiExpr(node.expression, ctx, where);
        return;
      case 'ConditionalExpression':
        walk(node.test, ctx);
        uiExpr(node.consequent, ctx, where);
        uiExpr(node.alternate, ctx, where);
        return;
      case 'LogicalExpression':
        walk(node.left, ctx);
        uiExpr(node.right, ctx, where);
        return;
      case 'Literal':
        if (typeof node.value === 'string') {
          handled.add(node);
          const call = stringCall(node.value, ctx, where, node.start);
          if (call) replace(node.start, node.end, call);
        }
        return;
      case 'TemplateLiteral':
        rewriteTemplate(node, ctx, where);
        return;
      default:
        walk(node, ctx);
    }
  }

  /** A position whose strings are code: mark them, walk everything else. */
  function codeExpr(node: N, ctx: Ctx): void {
    if (!node) return;
    switch (node.type) {
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
        codeExpr(node.expression, ctx);
        return;
      case 'ConditionalExpression':
        walk(node.test, ctx);
        codeExpr(node.consequent, ctx);
        codeExpr(node.alternate, ctx);
        return;
      case 'LogicalExpression':
        codeExpr(node.left, ctx);
        codeExpr(node.right, ctx);
        return;
      case 'BinaryExpression':
        codeExpr(node.left, ctx);
        codeExpr(node.right, ctx);
        return;
      case 'Literal':
        handled.add(node);
        return;
      case 'TemplateLiteral':
        handled.add(node);
        for (const e of node.expressions) codeExpr(e, ctx);
        return;
      case 'ArrayExpression':
        for (const e of node.elements) if (e) codeExpr(e, ctx);
        return;
      case 'ObjectExpression':
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') walk(p.argument, ctx);
          else {
            if (!p.computed) handled.add(p.key);
            else walk(p.key, ctx);
            if (p.kind === 'init' && !p.method) codeExpr(p.value, ctx);
            else walk(p.value, ctx);
          }
        }
        return;
      case 'CallExpression':
        if (isCopyCallee(node.callee) || SINKS.has(calleeName(node.callee) ?? '')) {
          walk(node, ctx);
          return;
        }
        walk(node.callee, ctx);
        for (const a of node.arguments) codeExpr(a, ctx);
        return;
      default:
        walk(node, ctx);
    }
  }

  // ------------------------------------------------------------------------------ copy() calls

  const isCopyCallee = (c: N): boolean => {
    if (!copyImport) return false;
    if (c.type === 'Identifier') return c.name === copyImport.local;
    return (
      c.type === 'MemberExpression' &&
      !c.computed &&
      c.object.type === 'Identifier' &&
      c.object.name === copyImport.local &&
      (c.property.name === 'plain' || c.property.name === 'list')
    );
  };

  /** Rule 10: `copy('…')`, `copy('… {n}', { n })`, `copy.plain(…)`, `copy.list([…])`. */
  const rewriteCopy = (node: N, ctx: Ctx): boolean => {
    const c = node.callee;
    const variant = c.type === 'Identifier' ? 'copy' : (c.property.name as 'plain' | 'list');
    const args: N[] = node.arguments;
    const plain = variant === 'plain' || ctx.plain;
    const pctx = plain && !ctx.plain ? { ...ctx, plain: true } : ctx;
    if (variant === 'list') {
      const arr = unwrapTs(args[0]);
      if (args.length !== 1 || arr?.type !== 'ArrayExpression' || !arr.elements.every((e: N) => strValue(unwrapTs(e)) !== null)) {
        issue('copy-arg', node.start, snippet(node), 'copy.list() takes one array of string literals');
        return false;
      }
      if (ctx.depth === 0) warn('module-copy', node.start, snippet(node), 'copy.list() at module level is read once: live edits show after a restart');
      emitList(node, arr, pctx, 'copy.list()', ctx.path);
      copyRewrites++;
      return true;
    }
    const v = strValue(args[0]);
    if (v === null || args.length > 2 || args.some((a) => a.type === 'SpreadElement')) {
      issue('copy-arg', node.start, snippet(node), 'copy() needs a literal text (and optionally one values object)');
      return false;
    }
    handled.add(args[0]);
    if (!HAS_TEXT.test(v)) return false;
    if (ctx.depth === 0) warn('module-copy', node.start, v, 'copy() at module level is read once: live edits show after a restart');
    const d = v.normalize('NFC');
    if (TAG_SYNTAX.test(d)) {
      fail('syntax', node.start, d, 'Looks like an inline tag; reword it');
      return false;
    }
    const [, core] = splitEdges(d);
    const key = record(pctx, core, 's', 'copy()', node.start, { parts: [d] });
    if (args.length === 1) {
      used.add('__t');
      replace(node.start, node.end, `__t(${lit(key)}, ${lit(d)}${plain ? ', 1' : ''})`);
    } else {
      used.add('__tm');
      replace(node.start, args[1].start, `__tm(${lit(key)}, ${lit(d)}, ${seqOpen(args[1])}`);
      replace(args[1].end, node.end, `${seqClose(args[1])}, ${plain ? 1 : 0})`);
      walk(args[1], ctx);
    }
    copyRewrites++;
    return true;
  };

  /** `__tl([keys], [defaults])` for a string array (tables and copy.list). */
  const emitList = (target: N, arr: N, ctx: Ctx, where: string, path: string | null) => {
    const keys: string[] = [];
    const defs: string[] = [];
    arr.elements.forEach((e: N, i: number) => {
      const u = unwrapTs(e);
      handled.add(u);
      const v = (strValue(u) ?? '').normalize('NFC');
      defs.push(lit(v));
      if (!HAS_TEXT.test(v)) {
        keys.push('""');
        return;
      }
      const [, core] = splitEdges(v);
      const ictx = path ? { ...ctx, path: `${path}[${i}]` } : ctx;
      keys.push(lit(record(ictx, core, 's', where, u.start, { parts: [v] })));
    });
    used.add('__tl');
    replace(target.start, target.end, `__tl([${keys.join(', ')}], [${defs.join(', ')}]${ctx.plain ? ', 1' : ''})`);
  };

  // ------------------------------------------------------------------------------ JSX children

  const isInlineTag = (el: N): boolean => {
    if (el.type !== 'JSXElement') return false;
    const name = jsxName(el.openingElement.name);
    if (!INLINE_TAGS.has(name) || el.openingElement.attributes.length) return false;
    for (const ch of el.children) {
      if (ch.type === 'JSXText') {
        if (decodeEntities(ch.value) === null) return false;
        if (name === 'br' && cleanJsxText(ch.value)) return false;
        continue;
      }
      if (ch.type === 'JSXExpressionContainer') {
        if (ch.expression.type === 'JSXEmptyExpression' || isStr(ch.expression)) continue;
        return false;
      }
      if (!isInlineTag(ch)) return false;
    }
    // An empty tag (a colour swatch: `<i /> Shared plans`) is an element, not markup: the owner would
    // see `<i></i>` and could delete it by rewording. It stays outside the message.
    if (name !== 'br' && !el.children.some((ch: N) => inlineContent(ch))) return false;
    return true;
  };
  const inlineContent = (ch: N): boolean =>
    (ch.type === 'JSXText' && cleanJsxText(decodeEntities(ch.value) ?? '') !== '') ||
    (ch.type === 'JSXExpressionContainer' && isStr(ch.expression) && ch.expression.value !== '') ||
    (ch.type === 'JSXElement' && isInlineTag(ch));
  /** Canonical `<em>…</em>` for a tag, collecting the text pieces React renders inside it. */
  const renderTag = (el: N, inner: string[]): string => {
    const name = jsxName(el.openingElement.name);
    if (name === 'br') return '<br/>';
    let out = `<${name}>`;
    for (const ch of el.children) {
      if (ch.type === 'JSXText') {
        const t = cleanJsxText(decodeEntities(ch.value)!);
        if (t) {
          out += t;
          inner.push(t);
        }
      } else if (ch.type === 'JSXExpressionContainer') {
        if (isStr(ch.expression)) {
          out += ch.expression.value;
          inner.push(ch.expression.value);
          handled.add(ch.expression);
        }
      } else out += renderTag(ch, inner);
    }
    return `${out}</${name}>`;
  };

  const processChildren = (node: N, tag: string | null, isDom: boolean, ctx: Ctx) => {
    const stringOnly = !!tag && isDom && STRING_ONLY_PARENTS.has(tag);
    const where = tag ?? 'fragment';
    const parts: Part[] = [];
    let noMessage = false;
    let messagePlain = false;
    let pending: Directive | null = null;
    for (const ch of node.children as N[]) {
      const dir: Directive | null = pending;
      pending = null;
      if (ch.type === 'JSXText') {
        const dec = decodeEntities(ch.value);
        if (dec === null) {
          issue('entity', ch.start, ch.value, 'Unknown HTML entity: this text is left as it is (use the character itself)');
          noMessage = true;
          parts.push({ kind: 'empty', node: ch });
          continue;
        }
        const t = cleanJsxText(dec);
        if (!t) {
          pending = dir;
          parts.push({ kind: 'empty', node: ch });
          continue;
        }
        if (dir === 'ignore') noMessage = true;
        if (dir === 'plain') messagePlain = true;
        parts.push({ kind: 'text', node: ch, text: t });
        continue;
      }
      if (ch.type === 'JSXExpressionContainer') {
        const e = ch.expression;
        if (e.type === 'JSXEmptyExpression') {
          pending = directiveIn(ch) ?? dir;
          parts.push({ kind: 'empty', node: ch });
          continue;
        }
        const sv = strValue(e);
        if (sv !== null) {
          handled.add(e);
          if (dir === 'ignore') noMessage = true;
          if (dir === 'plain') messagePlain = true;
          parts.push({ kind: 'text', node: ch, text: sv });
          continue;
        }
        parts.push({ kind: 'atom', node: ch, ignored: dir === 'ignore', plain: dir === 'plain' });
        continue;
      }
      if (ch.type === 'JSXElement' && dir !== 'ignore' && isInlineTag(ch)) {
        const inner: string[] = [];
        const render = renderTag(ch, inner);
        parts.push({ kind: 'tag', node: ch, render, inner });
        continue;
      }
      parts.push({ kind: 'atom', node: ch, ignored: dir === 'ignore', plain: dir === 'plain' });
    }

    const textOf = (p: Part) => (p.kind === 'text' ? p.text! : p.kind === 'tag' ? p.inner!.join('') : '');
    const anchors = parts.flatMap((p, i) => ((p.kind === 'text' && HAS_TEXT.test(p.text!)) || p.kind === 'tag' ? [i] : []));
    const hasText = parts.some((p) => HAS_TEXT.test(textOf(p)));
    if (!noMessage && hasText && anchors.length) {
      // The span runs from the first text (or tag) to the last, and takes in values right at its edges
      // (`{n} people`, `build {__LORE_BUILD__}`) but never an element there (`<Plus /> Create` is "Create").
      let a = anchors[0]!;
      let b = anchors[anchors.length - 1]!;
      const extendable = (p: Part) =>
        p.kind === 'empty' || p.kind === 'text' || (p.kind === 'atom' && !p.ignored && p.node.type === 'JSXExpressionContainer' && !hasJsx(p.node.expression));
      while (a > 0 && extendable(parts[a - 1]!)) a--;
      while (b < parts.length - 1 && extendable(parts[b + 1]!)) b++;
      while (a < b && parts[a]!.kind === 'empty') a++;
      while (b > a && parts[b]!.kind === 'empty') b--;
      emitMessage(parts.slice(a, b + 1), where, stringOnly, messagePlain ? { ...ctx, plain: true } : ctx);
    }
    else if (noMessage) for (const p of parts) if (p.kind === 'text' || p.kind === 'tag') skipped.push(...(p.kind === 'text' ? [p.text!] : p.inner!));

    for (const p of parts) {
      if (p.kind === 'atom' && p.ignored) skip(p.node);
      if (p.kind !== 'atom' || p.ignored) continue;
      const pctx = p.plain && !ctx.plain ? { ...ctx, plain: true } : ctx;
      if (p.node.type === 'JSXExpressionContainer') uiExpr(p.node.expression, pctx, where);
      else walk(p.node, pctx);
    }
  };

  /** Rule 1 / 4.6: the children of one element become one message. */
  const emitMessage = (span: Part[], where: string, stringOnly: boolean, ctx: Ctx) => {
    const atoms = span.filter((p) => p.kind === 'atom');
    const atomExpr = (p: Part) => (p.node.type === 'JSXExpressionContainer' ? p.node.expression : p.node);
    if (stringOnly) {
      const bad = span.find((p) => p.kind === 'tag' || (p.kind === 'atom' && /^JSX/.test(unwrapTs(atomExpr(p)).type)));
      if (bad) {
        fail('string-element', bad.node.start, snippet(bad.node), `<${where}> takes plain text only: an element can't be a placeholder here`);
        return;
      }
    }
    const names = nameAll(atoms.map(atomExpr));
    const nameOf = new Map<Part, string>();
    atoms.forEach((p, i) => nameOf.set(p, names[i]!));
    const clash = syntaxClash(span.filter((p) => p.kind === 'text').map((p) => p.text!), names);
    if (clash !== null) {
      fail('syntax', span[0]!.node.start, clash, 'Text that reads as message syntax ({name} or an inline tag); reword it or mark it {/* copy:ignore */}');
      return;
    }
    let msg = '';
    const pieces: string[] = [];
    for (const p of span) {
      if (p.kind === 'text') {
        msg += p.text;
        pieces.push(p.text!);
      } else if (p.kind === 'tag') {
        msg += p.render;
        pieces.push(...p.inner!);
      } else if (p.kind === 'atom') msg += `{${nameOf.get(p)}}`;
    }
    msg = msg.normalize('NFC');
    const [lead, core, trail] = splitEdges(msg);
    if (!HAS_TEXT.test(core)) return;
    if (ctx.depth === 0) issue('module-jsx', span[0]!.node.start, core, 'Module-level JSX with text is built once: move it into a component');
    const kind: CopyKind = stringOnly ? 's' : 'n';
    const ph: Record<string, string> = {};
    for (const p of atoms) ph[nameOf.get(p)!] = snippet(p.node.type === 'JSXExpressionContainer' ? p.node.expression : p.node);
    const key = record(ctx, core, kind, where, span[0]!.node.start, { ph, parts: pieces });
    const flags = (ctx.plain ? 1 : 0) | (kind === 'n' ? 2 : 0);
    const leadStr = lead ? `{${lit(lead)}}` : '';
    const trailStr = trail ? `{${lit(trail)}}` : '';
    let open: string;
    let close: string;
    if (!atoms.length) {
      const call = kind === 'n' ? `__tm(${lit(key)}, ${lit(core)}, {}, ${flags})` : `__t(${lit(key)}, ${lit(core)}${flags ? `, ${flags}` : ''})`;
      used.add(kind === 'n' ? '__tm' : '__t');
      open = `${leadStr}{${call}}`;
      close = trailStr;
    } else {
      used.add('__tm');
      open = `${leadStr}{__tm(${lit(key)}, ${lit(core)}, {`;
      close = ` }, ${flags})}${trailStr}`;
    }
    const lastI = span.length - 1;
    span.forEach((p, i) => {
      const pre = i === 0 ? open : '';
      const post = i === lastI ? close : '';
      if (p.kind !== 'atom') {
        replace(p.node.start, p.node.end, pre + post);
        return;
      }
      const name = lit(nameOf.get(p)!);
      if (p.node.type === 'JSXExpressionContainer') {
        // `{value}` -> ` "name": value,` (the braces become the object's syntax).
        const e = p.node.expression;
        replace(p.node.start, p.node.start + 1, `${pre} ${name}: ${seqOpen(e)}`);
        replace(p.node.end - 1, p.node.end, `${seqClose(e)},${post}`);
      } else {
        s.appendLeft(p.node.start, `${pre} ${name}: `);
        s.appendLeft(p.node.end, `,${post}`);
      }
    });
  };

  const hasJsx = (n: N): boolean => {
    if (!n || typeof n !== 'object') return false;
    if (Array.isArray(n)) return n.some(hasJsx);
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') return true;
    for (const k in n) if (!SKIP_KEYS.has(k) && n[k] && typeof n[k] === 'object' && hasJsx(n[k])) return true;
    return false;
  };

  // ----------------------------------------------------------------------------- JSX elements

  const checkKey = (e: N, pos: number) => {
    const reads = (n0: N): boolean => {
      const n = unwrapAll(n0);
      if (!n) return false;
      switch (n.type) {
        case 'Identifier':
          return TEXT_KEYS.has(n.name) || textParams.has(n.name);
        case 'MemberExpression':
          return !n.computed && n.property.type === 'Identifier' && TEXT_KEYS.has(n.property.name);
        case 'TemplateLiteral':
          return n.expressions.some(reads);
        case 'BinaryExpression':
        case 'LogicalExpression':
          return reads(n.left) || reads(n.right);
        case 'ConditionalExpression':
          return reads(n.consequent) || reads(n.alternate);
        case 'CallExpression':
          return n.arguments.some(reads);
        default:
          return false;
      }
    };
    if (reads(e)) issue('key', pos, snippet(e), 'key= reads words: two texts edited to the same words would collide; use an id or index');
  };

  const visitAttr = (a: N, tag: string, isDom: boolean, ctx0: Ctx) => {
    const ctx = enter(a, ctx0);
    if (!ctx) return;
    if (a.type === 'JSXSpreadAttribute') {
      walk(a.argument, ctx);
      return;
    }
    const name = attrName(a);
    const v = a.value;
    if (!v) return;
    const isText = isDom ? TEXT_DOM_ATTRS.has(name) || (name === 'label' && LABEL_DOM_TAGS.has(tag)) : TEXT_PROPS.has(name);
    const isCode = !isText && (CODE_PROPS.has(name) || /^on[A-Z]/.test(name) || name.startsWith('data-') || name.includes(':'));
    const where = `${tag} ${name}`;
    if (name === 'key' && v.type === 'JSXExpressionContainer') checkKey(v.expression, v.start);
    if (v.type === 'Literal') {
      handled.add(v);
      const dec = decodeEntities(v.value);
      if (dec === null) {
        if (isText) issue('entity', v.start, v.value, 'Unknown HTML entity: left as it is');
        return;
      }
      const val = cleanJsxAttr(dec);
      if (isText) {
        const call = stringCall(val, ctx, where, v.start);
        if (call) {
          replace(v.start, v.end, `{${call}}`);
          if (ctx.depth === 0) issue('module-jsx', v.start, val, 'Module-level JSX with text is built once');
        }
        return;
      }
      if (!isCode && LETTER.test(val)) issue('name', v.start, val, `<${tag} ${name}="…">: is "${name}" words or code? Add it to TEXT_* or CODE_PROPS in apps/web/vite/copyNames.ts`);
      return;
    }
    if (v.type === 'JSXExpressionContainer') {
      const e = v.expression;
      if (e.type === 'JSXEmptyExpression') return;
      if (isText) uiExpr(e, ctx, where);
      else if (isCode) codeExpr(e, ctx);
      else {
        if (uiTextIn(e)) issue('name', e.start, snippet(e), `<${tag} ${name}={…}>: is "${name}" words or code? Add it to apps/web/vite/copyNames.ts`);
        codeExpr(e, ctx);
      }
      return;
    }
    walk(v, ctx);
  };

  const visitJsx = (node: N, ctx: Ctx) => {
    if (ctx.comp) ctx.comp.hasJsx = true;
    if (node.type === 'JSXFragment') {
      processChildren(node, null, false, ctx);
      return;
    }
    const op = node.openingElement;
    const tag = jsxName(op.name);
    const isDom = /^[a-z]/.test(tag) && !tag.includes('.');
    if (isDom) {
      for (const a of op.attributes) {
        if (a.type === 'JSXAttribute' && attrName(a) === 'data-copy' && strValue(a.value) === 'off') {
          replace(a.start, a.end, '');
          skip(node.children);
          return;
        }
      }
    }
    for (const a of op.attributes) visitAttr(a, tag, isDom, ctx);
    if (isDom && SKIP_TAGS.has(tag)) {
      skip(node.children);
      return;
    }
    processChildren(node, tag, isDom, ctx);
  };

  // ---------------------------------------------------------------------- calls and objects

  const pascalValue = (n: N, ctx: Ctx) => {
    if (n?.type === 'Identifier' && pascalFns.has(n.name)) issue('pascal', n.start, n.name, `${n.name} is a component: render it as <${n.name} />, don't call it or pass it to a function`);
    void ctx;
  };

  const visitCall = (node: N, ctx: Ctx) => {
    const callee = node.callee;
    const cname = calleeName(callee);
    const args: N[] = node.arguments;
    if (node.type === 'CallExpression' && isCopyCallee(callee) && rewriteCopy(node, ctx)) return;
    if (node.type === 'CallExpression' && cname && SINKS.has(cname)) {
      const u = unwrapAll(callee);
      if (u.type === 'Identifier' || (u.type === 'MemberExpression' && u.object.type === 'Identifier' && u.object.name === 'window')) {
        walk(callee, ctx);
        if (args[0]) uiExpr(args[0], ctx, cname);
        for (const a of args.slice(1)) walk(a, ctx);
        return;
      }
    }
    if (cname === 'useMemo' && args.length >= 2) {
      const deps = unwrapTs(args[1]);
      if (deps.type === 'ArrayExpression') {
        const close = deps.end - 1;
        const els = deps.elements.filter(Boolean);
        if (!els.length) s.appendLeft(close, '__copyTick()');
        else {
          const between = code.slice(els[els.length - 1].end, close).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
          s.appendLeft(close, between.includes(',') ? ' __copyTick()' : ', __copyTick()');
        }
        used.add('__copyTick');
      } else issue('memo-deps', args[1].start, snippet(args[1]), 'useMemo deps must be an array literal so live words can recompute');
    }
    if (callee.type === 'Identifier' && pascalFns.has(callee.name)) issue('pascal', callee.start, callee.name, `${callee.name}() is a component called as a function: render it as <${callee.name} />`);
    if (!VALUE_OK_CALLS.has(cname ?? '')) for (const a of args) pascalValue(a, ctx);
    // `.map(word => …)` over words: remember `word` for the key= check.
    if (cname && /^(map|forEach|flatMap|filter)$/.test(cname) && callee.type === 'MemberExpression') {
      const obj = unwrapAll(callee.object);
      const overWords =
        (obj?.type === 'ArrayExpression' && obj.elements.some((e: N) => isStr(e) && proseLike(e.value))) ||
        (obj?.type === 'Identifier' && textArrays.has(obj.name)) ||
        (obj?.type === 'CallExpression' && isCopyCallee(obj.callee));
      const fn = args[0];
      if (overWords && fn && /Function/.test(fn.type) && fn.params[0]?.type === 'Identifier') textParams.add(fn.params[0].name);
    }
    walk(callee, ctx);
    if (cname && CODE_CALLS.has(cname)) for (const a of args) codeExpr(a, ctx);
    else for (const a of args) walk(a, ctx);
  };

  const getterize = (p: N, ctx: Ctx, where: string) => {
    const v = unwrapTs(p.value);
    if (isStr(v)) {
      handled.add(v);
      const call = stringCall(v.value, ctx, where, v.start);
      if (call) replace(p.start, p.end, `get ${keySrc(p)}() { return ${call}; }`);
      return;
    }
    replace(p.start, p.value.start, `get ${keySrc(p)}() { return `);
    uiExpr(p.value, ctx, where);
    s.appendLeft(p.end, '; }');
  };

  const visitObject = (node: N, ctx: Ctx) => {
    for (const p of node.properties as N[]) {
      const pc = enter(p, ctx);
      if (!pc) continue;
      if (p.type === 'SpreadElement') {
        walk(p.argument, pc);
        continue;
      }
      if (!p.computed) handled.add(p.key);
      else walk(p.key, pc);
      if (p.kind !== 'init' || p.method) {
        walk(p.value, pc);
        continue;
      }
      if (p.shorthand) continue;
      const kn = keyName(p);
      if (kn !== null && CODE_KEYS.has(kn)) {
        codeExpr(p.value, pc);
        continue;
      }
      if (kn !== null && TEXT_KEYS.has(kn) && uiTextIn(p.value)) {
        if (pc.depth === 0) getterize(p, pc, kn);
        else uiExpr(p.value, pc, kn);
        continue;
      }
      if (kn !== 'Component') pascalValue(p.value, pc);
      walk(p.value, pc);
    }
  };

  // ------------------------------------------------------------------------------------ tables

  const tableObject = (obj: N, ctx: Ctx, path: string) => {
    for (const p of obj.properties as N[]) {
      const pc = enter(p, ctx);
      if (!pc) continue;
      if (p.type === 'SpreadElement') {
        walk(p.argument, pc);
        continue;
      }
      if (!p.computed) handled.add(p.key);
      else walk(p.key, pc);
      if (p.kind !== 'init' || p.method || p.shorthand) {
        walk(p.value, pc);
        continue;
      }
      const kn = keyName(p) ?? '?';
      const sub = /^[A-Za-z_$][\w$]*$/.test(kn) ? `${path}.${kn}` : `${path}[${lit(kn)}]`;
      if (CODE_KEYS.has(kn)) {
        codeExpr(p.value, pc);
        continue;
      }
      const u = unwrapTs(p.value);
      if (u?.type === 'ObjectExpression') tableObject(u, pc, sub);
      else if (u?.type === 'ArrayExpression') tableArray(u, pc, sub);
      else if (uiTextIn(p.value)) getterize(p, { ...pc, path: sub, plain: pc.plain || PLAIN_PATHS.has(sub), legal: pc.legal || LEGAL_PATH.test(sub) }, kn);
      else walk(p.value, pc);
    }
  };

  const tableArray = (arr: N, ctx: Ctx, path: string, topName?: string) => {
    const els: N[] = arr.elements;
    if (els.length && els.every((e) => e && strValue(unwrapTs(e)) !== null) && els.some((e) => HAS_TEXT.test(strValue(unwrapTs(e))!))) {
      emitList(arr, arr, { ...ctx, plain: ctx.plain || PLAIN_PATHS.has(path) }, 'list', path);
      if (topName) textArrays.add(topName);
      return;
    }
    els.forEach((e, i) => {
      if (!e) return;
      const u = unwrapTs(e);
      if (u.type === 'ObjectExpression') tableObject(u, ctx, `${path}[${i}]`);
      else if (u.type === 'ArrayExpression') tableArray(u, ctx, `${path}[${i}]`);
      else if (strValue(u) !== null && HAS_TEXT.test(strValue(u)!)) {
        handled.add(u);
        issue('table-mixed', u.start, strValue(u)!, 'A text inside a mixed array can\'t be a getter: make the array all strings or use objects');
      } else walk(e, ctx);
    });
  };

  // ------------------------------------------------------------------------- functions, module

  const visitFunction = (fn: N, ctx: Ctx, compName: string | null) => {
    const inner: Ctx = { ...ctx, depth: ctx.depth + 1 };
    if (compName && ctx.depth === 0 && !fn.async && !fn.generator) {
      const comp: Comp = { name: compName, fn, hasJsx: false, hasCopy: false };
      comps.push(comp);
      inner.comp = comp;
      inner.screen = compName;
    }
    for (const [i, prm] of (fn.params as N[]).entries()) {
      if (compName && i === 0 && prm.type === 'ObjectPattern') {
        for (const p of prm.properties as N[]) {
          if (p.type !== 'Property' || p.value.type !== 'AssignmentPattern') {
            walk(p, inner);
            continue;
          }
          const kn = keyName(p);
          const right = p.value.right;
          if (kn !== null && TEXT_PROPS.has(kn)) uiExpr(right, inner, `${kn} default`);
          else if (kn !== null && CODE_PROPS.has(kn)) codeExpr(right, inner);
          else {
            if (uiTextIn(right) && LETTER.test(code.slice(right.start, right.end))) issue('name', right.start, snippet(right), `Default value of "${kn}": words or code? Add it to apps/web/vite/copyNames.ts`);
            codeExpr(right, inner);
          }
        }
        continue;
      }
      walk(prm, inner);
    }
    walk(fn.body, inner);
  };

  const componentInit = (init: N): N | null => {
    const u = unwrapTs(init);
    if (!u) return null;
    if (u.type === 'ArrowFunctionExpression' || u.type === 'FunctionExpression') return u;
    if (u.type === 'CallExpression' && WRAPPERS.has(calleeName(u.callee) ?? '') && u.arguments[0]) {
      const a = unwrapTs(u.arguments[0]);
      if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression') return a;
    }
    return null;
  };

  const visitModuleVar = (decl: N, outer: N, ctx: Ctx) => {
    const tableNote = annots.get(outer.start) === 'table' || annots.get(decl.start) === 'table';
    for (const d of decl.declarations as N[]) {
      const dc = enter(d, ctx);
      if (!dc) continue;
      const name: string | null = d.id.type === 'Identifier' ? d.id.name : null;
      if (name && NEVER_TABLES.has(name)) continue; // safety data: never copy (section 9)
      if (!d.init) continue;
      const init = unwrapTs(d.init);
      const isTable = decl.kind === 'const' && !!name && (/_(LABELS|LINES)$/.test(name) || TABLE_NAMES.has(name) || tableNote);
      if (isTable && init.type === 'ObjectExpression') {
        tableObject(init, { ...dc, path: name }, name!);
        continue;
      }
      if (isTable && init.type === 'ArrayExpression') {
        tableArray(init, { ...dc, path: name }, name!, name!);
        continue;
      }
      const fn = name && PASCAL.test(name) ? componentInit(d.init) : null;
      if (fn) {
        if (fn !== init) walk(init.callee, dc);
        visitFunction(fn, dc, name);
        continue;
      }
      walk(d.init, dc);
    }
  };

  // ---------------------------------------------------------------------------------- walker

  function walk(node: N, ctx0: Ctx): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, ctx0);
      return;
    }
    if (typeof node.type !== 'string') return;
    const ctx = enter(node, ctx0);
    if (!ctx) return;
    switch (node.type) {
      case 'JSXElement':
      case 'JSXFragment':
        visitJsx(node, ctx);
        return;
      case 'CallExpression':
      case 'NewExpression':
        visitCall(node, ctx);
        return;
      case 'ObjectExpression':
        visitObject(node, ctx);
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        visitFunction(node, ctx, null);
        return;
      case 'BinaryExpression':
        if (COMPARE.has(node.operator)) {
          codeExpr(node.left, ctx);
          codeExpr(node.right, ctx);
          return;
        }
        break;
      case 'SwitchCase':
        if (node.test) codeExpr(node.test, ctx);
        walk(node.consequent, ctx);
        return;
      case 'MemberExpression':
        walk(node.object, ctx);
        if (node.computed) codeExpr(node.property, ctx);
        return;
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
        return;
      case 'ImportExpression':
        codeExpr(node.source, ctx);
        return;
      case 'ExportNamedDeclaration':
        if (!node.source) walk(node.declaration, ctx);
        return;
      case 'ExpressionStatement':
        if (node.directive) return;
        break;
      case 'Property':
        if (!node.computed) handled.add(node.key);
        else walk(node.key, ctx);
        walk(node.value, ctx);
        return;
      case 'ArrayExpression':
        for (const e of node.elements) {
          pascalValue(e, ctx);
          walk(e, ctx);
        }
        return;
      case 'Identifier':
        if (copyImport && node.name === copyImport.local) copyRefs++;
        return;
      case 'Literal':
        if (typeof node.value === 'string' && !handled.has(node) && proseLike(node.value)) {
          issue('prose', node.start, node.value, 'Words the transform does not reach: use copy(), move them into JSX, or mark // copy:ignore');
        }
        return;
      case 'TemplateLiteral': {
        // Only the literal parts count (4.5): `${a}T${b}` is code, `${n} min ago` is words.
        const lit = node.quasis.map((q: N) => q.value.cooked ?? '').join('');
        if (!handled.has(node) && proseLike(lit)) {
          issue('prose', node.start, node.quasis.map((q: N) => q.value.cooked ?? '').join('{}'), 'Words the transform does not reach: use copy(), move them into JSX, or mark // copy:ignore');
        } else if (!handled.has(node) && !LETTER.test(lit) && /\s/.test(lit)) {
          // Words put together around spaces: `${n === 1 ? 'source' : 'sources'} ${list}`. Single
          // lowercase words aren't prose by themselves, but a ternary choosing one here is.
          for (const b of node.expressions.flatMap(wordBranches)) {
            if (!handled.has(b)) issue('prose', b.start, b.value, 'Words the transform does not reach: use copy(), move them into JSX, or mark // copy:ignore');
          }
        }
        walk(node.expressions, ctx);
        return;
      }
      case 'AssignmentExpression':
        // `h.authorization = …`: a code field.
        if (node.left.type === 'MemberExpression' && !node.left.computed && CODE_KEYS.has(node.left.property.name)) {
          walk(node.left, ctx);
          codeExpr(node.right, ctx);
          return;
        }
        break;
      case 'TaggedTemplateExpression':
        walk(node.tag, ctx);
        walk(node.quasi.expressions, ctx);
        return;
      case 'JSXText':
        return;
    }
    if (node.type.startsWith('TS') && !TS_EXPR.has(node.type)) return;
    for (const k in node) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v, ctx);
    }
  }

  // ----------------------------------------------------------------------------------- run it

  const program = parsed.program;
  const top: Ctx = { depth: 0, comp: null, plain: false, legal: false, path: null, screen: info.screen };

  // Pre-pass: the `copy` import and the component names (for the call/value check).
  for (const st of program.body as N[]) {
    const decl = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
    if (st.type === 'ImportDeclaration') {
      const src = st.source.value as string;
      for (const sp of st.specifiers as N[]) {
        const imported = sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value) : null;
        if ((src === '#shared' || src === '#shared/copy') && imported === 'copy' && st.importKind !== 'type' && sp.importKind !== 'type') {
          copyImport = { decl: st, spec: sp, local: sp.local.name };
        }
        if (/^\.\.?\//.test(src) && /\.tsx$/.test(src) && PASCAL.test(sp.local.name)) pascalFns.add(sp.local.name);
      }
    }
    if (decl?.type === 'FunctionDeclaration' && decl.id && PASCAL.test(decl.id.name)) pascalFns.add(decl.id.name);
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations as N[]) if (d.id.type === 'Identifier' && PASCAL.test(d.id.name) && componentInit(d.init)) pascalFns.add(d.id.name);
    }
  }

  for (const st of program.body as N[]) {
    const ctx = enter(st, top);
    if (!ctx) continue;
    if (st.type === 'ImportDeclaration') continue;
    const decl = st.type === 'ExportNamedDeclaration' ? (st.source ? null : st.declaration) : st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
    if (!decl) continue;
    const dctx = decl === st ? ctx : enter(decl, ctx);
    if (!dctx) continue;
    if (decl.type === 'VariableDeclaration') visitModuleVar(decl, st, dctx);
    else if (decl.type === 'FunctionDeclaration' || (st.type === 'ExportDefaultDeclaration' && decl.type === 'FunctionExpression')) {
      const name = decl.id?.name ?? (st.type === 'ExportDefaultDeclaration' ? 'Default' : null);
      visitFunction(decl, dctx, name && PASCAL.test(name) ? name : null);
    } else walk(decl, dctx);
  }

  // 4.8: every component that renders words re-renders when they change.
  for (const c of comps) {
    if (!c.hasJsx && !c.hasCopy) continue;
    const body = c.fn.body;
    used.add('__useCopy');
    if (body.type === 'BlockStatement') s.appendLeft(body.start + 1, ' __useCopy();');
    else {
      s.prependLeft(body.start, '{ __useCopy(); return ');
      s.appendLeft(body.end, '; }');
    }
  }

  // The `copy` import goes when every use was rewritten (and `#shared` needn't export it yet).
  if (copyImport && copyRewrites && !copyRefs) {
    const { decl, spec } = copyImport;
    const specs = decl.specifiers as N[];
    const i = specs.indexOf(spec);
    if (specs.length === 1) replace(decl.start, decl.end, '');
    else if (i < specs.length - 1) replace(spec.start, specs[i + 1].start, '');
    else replace(specs[i - 1].end, spec.end, '');
  }

  if (used.size) s.prepend(`import { ${[...used].sort().join(', ')} } from ${lit(RUNTIME_ID)};`);
  return result();
}

// ------------------------------------------------------------------------------ files, catalog

export interface Roots {
  srcRoot?: string;
  vocabulary?: string | null;
  legal?: readonly string[];
}

/** Where a file sits: its key scope and display path. null = not a copy source. */
export function fileInfo(file: string, roots: Roots = {}): FileInfo | null {
  const f = normAbs(file.replace(/[?#].*$/, ''));
  const vocab = roots.vocabulary === null ? null : normAbs(roots.vocabulary ?? VOCABULARY);
  if (vocab && f.toLowerCase() === vocab.toLowerCase()) {
    return { scope: 'shared/vocabulary', display: 'packages/shared/src/vocabulary.ts', screen: 'vocabulary', legal: false };
  }
  const src = normAbs(roots.srcRoot ?? WEB_SRC);
  if (!f.toLowerCase().startsWith(`${src.toLowerCase()}/`)) return null;
  const rel = f.slice(src.length + 1);
  if (!/\.(tsx?)$/.test(rel) || rel.endsWith('.d.ts')) return null;
  const scope = rel.replace(/\.tsx?$/, '');
  return { scope, display: rel, screen: path.posix.basename(scope), legal: (roots.legal ?? []).includes(scope) };
}

/** Files the copy layer must never touch: the runtime and the editor itself (section 9). */
export function isCopyMachinery(file: string, srcRoot: string = WEB_SRC): boolean {
  const f = normAbs(file).toLowerCase();
  const src = normAbs(srcRoot).toLowerCase();
  return f.startsWith(`${src}/lib/copy/`) || f.startsWith(`${src}/components/copyeditor/`);
}

/** Every web source the transform handles (apps/web/src, minus the copy machinery). */
export function listWebSources(srcRoot: string = WEB_SRC): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const f = `${dir}/${name}`;
      if (statSync(f).isDirectory()) visit(f);
      else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !isCopyMachinery(f, srcRoot)) out.push(f);
    }
  };
  visit(normAbs(srcRoot));
  return out;
}

export function listServerSources(roots: readonly string[] = SERVER_SOURCES): string[] {
  const out: string[] = [];
  const visit = (p: string) => {
    if (statSync(p).isDirectory()) for (const name of readdirSync(p).sort()) visit(`${p}/${name}`);
    else if (/\.ts$/.test(p) && !p.endsWith('.d.ts')) out.push(p);
  };
  for (const r of roots) visit(normAbs(r));
  return out;
}

/** Merge occurrences into the catalog (4.3). Same key, different text = collision (build error). */
export function buildCatalog(occurrences: readonly Occurrence[], build: string): { catalog: Catalog; errors: CopyIssue[] } {
  const keys: Record<string, CatalogEntry> = {};
  const allPlain = new Map<string, boolean>();
  const errors: CopyIssue[] = [];
  for (const o of occurrences) {
    const e = keys[o.key];
    allPlain.set(o.key, (allPlain.get(o.key) ?? true) && !!o.plain);
    if (!e) {
      const entry: CatalogEntry = { text: o.text, kind: o.kind, at: [o.at], ctx: o.ctx };
      if (o.ph) entry.ph = o.ph;
      if (o.legal) entry.legal = 1;
      keys[o.key] = entry;
      continue;
    }
    if (e.text !== o.text) {
      errors.push({ kind: 'collision', at: o.at, text: o.text, message: `"${e.text}" (${e.at[0]}) and "${o.text}" share the key ${o.key}` });
      continue;
    }
    if (o.kind === 's') e.kind = 's';
    if (!e.at.includes(o.at)) e.at.push(o.at);
    if (o.legal) e.legal = 1;
    if (!e.ph && o.ph) e.ph = o.ph;
  }
  const sorted: Record<string, CatalogEntry> = {};
  for (const k of Object.keys(keys).sort()) {
    const e = keys[k]!;
    if (allPlain.get(k)) e.plain = 1;
    sorted[k] = e;
  }
  return { catalog: { build, keys: sorted }, errors };
}

/** Read and analyse every web source (+ vocabulary): occurrences and issues per file. */
export function collectWeb(roots: Roots = {}): { file: string; info: FileInfo; analysis: Analysis }[] {
  const files = listWebSources(roots.srcRoot ?? WEB_SRC);
  if (roots.vocabulary !== null) files.push(normAbs(roots.vocabulary ?? VOCABULARY));
  const out: { file: string; info: FileInfo; analysis: Analysis }[] = [];
  for (const file of files) {
    const info = fileInfo(file, roots);
    if (!info) continue;
    out.push({ file, info, analysis: analyzeFile(readFileSync(file, 'utf8'), info) });
  }
  return out;
}

// --------------------------------------------------------------------------- server messages

const SRV_HELPERS = new Set(['badRequest', 'conflict', 'forbidden', 'unauthorized']);

export interface ServerScan {
  occurrences: Occurrence[];
  /** Messages with holes (templates): not editable until server copy() takes them (R2). */
  notEditable: { at: string; text: string }[];
}

/**
 * 5.6: static server messages found in the code become `srv#<hash>` keys: string literals given to
 * badRequest/conflict/forbidden/unauthorized/HttpError (and their `fields`), notFound('X'), the
 * helpers' defaults, `{ code, message }` replies, app.ts's `say('…')` replies, zod messages in
 * shared/inputs.ts, and server `copy()` calls. Messages built from data are never keys, so no Lorer's words reach the public list.
 */
export function scanServerMessages(files: readonly { file: string; code: string }[]): ServerScan {
  const occurrences: Occurrence[] = [];
  const notEditable: { at: string; text: string }[] = [];
  for (const { file, code } of files) {
    const f = normAbs(file);
    const display = f.toLowerCase().startsWith(`${REPO.toLowerCase()}/`) ? f.slice(REPO.length + 1) : f;
    const isInputs = /packages\/shared\/src\/inputs\.ts$/.test(f);
    const isErrors = /apps\/api\/src\/lib\/errors\.ts$/.test(f);
    const parsed = parseSync(display, code, { lang: 'ts', astType: 'ts' }) as unknown as { program: N; errors: N[] };
    if (parsed.errors.length) continue;
    const lineOf = (pos: number) => code.slice(0, pos).split('\n').length;
    const add = (value: string, pos: number, ctx: string) => {
      if (!HAS_TEXT.test(value)) return;
      const text = splitEdges(value.normalize('NFC'))[1];
      occurrences.push({ key: `srv#${hashText(text)}`, text, kind: 's', at: `${display}:${lineOf(pos)}`, ctx });
    };
    const message = (n: N, ctx: string) => {
      if (!n) return;
      const u = n.type === 'TSAsExpression' || n.type === 'ParenthesizedExpression' ? n.expression : n;
      if (u.type === 'Literal' && typeof u.value === 'string') add(u.value, u.start, ctx);
      else if (u.type === 'TemplateLiteral') {
        if (!u.expressions.length) add(u.quasis[0].value.cooked ?? '', u.start, ctx);
        else notEditable.push({ at: `${display}:${lineOf(u.start)}`, text: code.slice(u.start, u.end) });
      }
    };
    const fields = (n: N) => {
      if (n?.type !== 'ObjectExpression') return;
      for (const p of n.properties) if (p.type === 'Property') message(p.value, 'Server message (field)');
    };
    let copyLocal: string | null = null;
    for (const st of parsed.program.body as N[]) {
      // Inside packages/shared, copy() comes from './copy.ts' (vocabulary.ts can't import #shared: a cycle).
      const fromShared = st.type === 'ImportDeclaration' && (st.source.value === '#shared' || st.source.value === '#shared/copy' || (st.source.value === './copy.ts' && /packages\/shared\/src\//.test(f)));
      if (!fromShared) continue;
      for (const sp of st.specifiers as N[]) if (sp.type === 'ImportSpecifier' && (sp.imported.name ?? sp.imported.value) === 'copy') copyLocal = sp.local.name;
    }
    const visit = (node: N, fnName: string | null): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const x of node) visit(x, fnName);
        return;
      }
      if (typeof node.type !== 'string') return;
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const c = node.callee;
        const name = c.type === 'Identifier' ? c.name : null;
        const args: N[] = node.arguments;
        if (name && SRV_HELPERS.has(name)) {
          message(args[0], 'Server message');
          fields(args[1]);
        } else if (node.type === 'NewExpression' && name === 'HttpError') {
          message(args[2], 'Server message');
          fields(args[3]);
        } else if (name === 'say') {
          // app.ts's error handler: fixed replies (`say('Not found.')`) go out in the owner's words.
          message(args[0], 'Server message');
        } else if (name === 'notFound') {
          const a = args[0];
          if (!a) add('That could not be found.', node.start, 'Server message');
          else if (a.type === 'Literal' && typeof a.value === 'string') add(`${a.value} could not be found.`, a.start, 'Server message');
          else notEditable.push({ at: `${display}:${lineOf(node.start)}`, text: code.slice(node.start, node.end) });
        } else if (copyLocal && (name === copyLocal || (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === copyLocal && c.property.name === 'plain'))) {
          message(args[0], 'Server text (copy)');
        } else if (isInputs && c.type === 'MemberExpression') {
          for (const a of args.slice(1)) message(a, 'Input check');
        }
      }
      if (node.type === 'ObjectExpression') {
        const props = (node.properties as N[]).filter((p) => p.type === 'Property' && !p.computed);
        const named = (k: string) => props.find((p) => (p.key.name ?? p.key.value) === k);
        const msg = named('message');
        if (msg && (named('code') || isInputs)) message(msg.value, isInputs ? 'Input check' : 'Server message');
        const err = named('error');
        if (isInputs && err) message(err.value, 'Input check');
      }
      if (isErrors && node.type === 'VariableDeclarator' && node.id.type === 'Identifier') fnName = node.id.name;
      if (isErrors && node.type === 'AssignmentPattern' && (fnName === 'unauthorized' || fnName === 'forbidden')) message(node.right, 'Server message');
      if (isErrors && node.type === 'AssignmentPattern' && fnName === 'notFound' && node.right.type === 'Literal') {
        add(`${node.right.value} could not be found.`, node.right.start, 'Server message');
      }
      for (const k in node) {
        if (SKIP_KEYS.has(k)) continue;
        const v = node[k];
        if (v && typeof v === 'object') visit(v, fnName);
      }
    };
    visit(parsed.program, null);
  }
  return { occurrences, notEditable };
}
