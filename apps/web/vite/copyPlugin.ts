// Live text, build side: rewrites every static UI text into a lookup the owner can override from the
// app, and emits copy-catalog.json (every key that exists in this build). Spec: LIVE_TEXT_SPEC.md 4.
//
//   <h2>The one who almost stayed home</h2>
//   -> <h2>{__tm("pages/Home#1a2b3c4d", "The one who almost stayed home", {}, 2)}</h2>
//
// The runtime behind `virtual:lore-copy` is apps/web/src/lib/copy/runtime.ts.

import { readFileSync } from 'node:fs';
import type { SourceMap } from 'magic-string';
import type { Plugin } from 'vite';
import {
  analyzeFile,
  buildCatalog,
  fileInfo,
  isCopyMachinery,
  listServerSources,
  listWebSources,
  normAbs,
  RUNTIME_ID,
  scanServerMessages,
  SERVER_SOURCES,
  VOCABULARY,
  WEB_SRC,
  type Catalog,
  type CopyIssue,
  type Occurrence,
  type Roots,
} from './collect.ts';

export interface LoreCopyOptions {
  /** Scopes whose texts are legal / consent text (flagged in the editor): `['pages/Legal']`. */
  legal?: string[];
  /** Build id written into the catalog (the server checks publishes against it). */
  build?: string;
  /** Root the key scopes are relative to. Default apps/web/src. */
  srcRoot?: string;
  /** The module `virtual:lore-copy` resolves to. Default <srcRoot>/lib/copy/runtime.ts. */
  runtime?: string;
  /** The shared vocabulary file (tables), or false. */
  vocabulary?: string | false;
  /** Server sources scanned for static messages (5.6), or false. */
  server?: string[] | false;
  /** Scan everything at start and emit copy-catalog.json. Default true. */
  catalog?: boolean;
}

export interface TransformResult {
  code: string;
  map: SourceMap;
  entries: Occurrence[];
  /** Coverage problems (the coverage test fails on these; the build does not). */
  issues: CopyIssue[];
  warnings: CopyIssue[];
  /** Build errors: collisions, defaults that read as message syntax, elements in string-only spots. */
  errors: CopyIssue[];
  changed: boolean;
}

/** The pure transform: tests call this directly. */
export function transformCopy(code: string, file: string, opts: Roots & { scope?: string } = {}): TransformResult {
  const info = opts.scope
    ? { scope: opts.scope, display: file, screen: opts.scope.split('/').pop() ?? opts.scope, legal: (opts.legal ?? []).includes(opts.scope) }
    : fileInfo(file, opts);
  if (!info) throw new Error(`lore-copy: ${file} is not a copy source`);
  const a = analyzeFile(code, info);
  return {
    code: a.s.toString(),
    map: a.s.generateMap({ hires: 'boundary', source: file, includeContent: true }),
    entries: a.occurrences,
    issues: a.issues,
    warnings: a.warnings,
    errors: a.errors,
    changed: a.changed,
  };
}

const fmt = (i: CopyIssue) => `${i.at} ${i.kind}: ${i.message}${i.text ? ` ("${i.text}")` : ''}`;
const cleanUrl = (id: string) => id.replace(/[?#].*$/, '');
const SKIP_QUERY = /[?&](raw|url|inline|worker|sharedworker|nocopy)\b/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The catalog lists what the sources hold; the build ships less (a vocabulary table no screen uses is
 * tree-shaken out). Keys no chunk carries are dropped, so the owner can't find and publish words that
 * never show. Kept: server messages (srv#), and word-list tables the server names itself (it may send
 * those lines as messages, lib/copy.ts resolve).
 */
export function pruneUnshipped(c: Catalog, bundle: Record<string, { type: string; code?: string }>, server: string[]): void {
  const js = Object.values(bundle)
    .map((o) => (o.type === 'chunk' ? (o.code ?? '') : ''))
    .join('\n');
  let serverCode: string | null = null;
  for (const [k, e] of Object.entries(c.keys)) {
    if (k.startsWith('srv#') || js.includes(k)) continue;
    const table = k.startsWith('shared/vocabulary#') ? /^[A-Z][A-Z0-9_]*/.exec(e.ctx ?? '')?.[0] : undefined;
    if (table) {
      // The API's own code (the shared files it scans define the tables, so they'd always name them).
      serverCode ??= server.length
        ? listServerSources(server)
            .filter((f) => !f.includes('/packages/shared/'))
            .map((f) => readFileSync(f, 'utf8'))
            .join('\n')
        : '';
      if (serverCode.includes(table)) continue;
    }
    delete c.keys[k];
  }
}

export function loreCopy(opts: LoreCopyOptions = {}): Plugin {
  const srcRoot = normAbs(opts.srcRoot ?? WEB_SRC);
  const runtime = normAbs(opts.runtime ?? `${srcRoot}/lib/copy/runtime.ts`);
  const vocabulary = opts.vocabulary === false ? null : normAbs(opts.vocabulary ?? VOCABULARY);
  const server = opts.server === false ? [] : (opts.server ?? SERVER_SOURCES);
  const roots: Roots = { srcRoot, vocabulary, legal: opts.legal ?? [] };
  const build = opts.build ?? 'dev';
  const withCatalog = opts.catalog !== false;

  // The catalog: occurrences per file, kept current in dev.
  const perFile = new Map<string, Occurrence[]>();
  let serverOccurrences: Occurrence[] = [];

  const scanFile = (file: string): CopyIssue[] => {
    const info = fileInfo(file, roots);
    if (!info) return [];
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      perFile.delete(normAbs(file));
      return [];
    }
    const a = analyzeFile(code, info);
    // A file that doesn't parse (half-edited in another session) keeps its last texts, and its syntax
    // error is Vite's to report, with a code frame, when the module is requested.
    if (a.errors.some((e) => e.kind === 'parse')) return [];
    perFile.set(normAbs(file), a.occurrences);
    return a.errors;
  };
  const scanAll = (): CopyIssue[] => {
    const errors: CopyIssue[] = [];
    perFile.clear();
    for (const f of listWebSources(srcRoot)) errors.push(...scanFile(f));
    if (vocabulary) errors.push(...scanFile(vocabulary));
    if (server.length) {
      const files = listServerSources(server).map((file) => ({ file, code: readFileSync(file, 'utf8') }));
      serverOccurrences = scanServerMessages(files).occurrences;
    }
    return errors;
  };
  const catalog = (): { catalog: Catalog; errors: CopyIssue[] } => buildCatalog([...[...perFile.values()].flat(), ...serverOccurrences], build);

  const skip = (id: string) =>
    id.startsWith('\0') || id.includes('/node_modules/') || SKIP_QUERY.test(id) || cleanUrl(id).endsWith('.d.ts') || isCopyMachinery(cleanUrl(id), srcRoot);
  const include = [new RegExp(`^${escapeRe(srcRoot)}/.*\\.tsx?(\\?.*)?$`, 'i')];
  if (vocabulary) include.push(new RegExp(`^${escapeRe(vocabulary)}(\\?.*)?$`, 'i'));

  return {
    name: 'lore-copy',
    enforce: 'pre',
    resolveId: {
      filter: { id: new RegExp(`^${escapeRe(RUNTIME_ID)}$`) },
      handler: () => runtime,
    },
    buildStart() {
      if (!withCatalog) return;
      const errors = [...scanAll(), ...catalog().errors];
      if (errors.length) this.error(`lore-copy:\n${errors.map(fmt).join('\n')}`);
    },
    transform: {
      filter: { id: { include } },
      handler(code, id) {
        if (skip(id)) return null;
        const file = cleanUrl(id);
        const info = fileInfo(file, roots);
        if (!info) return null;
        const a = analyzeFile(code, info);
        // Syntax errors: Vite's own transform reports them with the location and a code frame.
        if (a.errors.some((e) => e.kind === 'parse')) return null;
        if (a.errors.length) this.error(`lore-copy:\n${a.errors.map(fmt).join('\n')}`);
        if (withCatalog) perFile.set(normAbs(file), a.occurrences);
        if (!a.changed) return null;
        return { code: a.s.toString(), map: a.s.generateMap({ hires: 'boundary', source: file, includeContent: true }) };
      },
    },
    watchChange(id) {
      if (withCatalog && fileInfo(cleanUrl(id), roots)) scanFile(cleanUrl(id));
    },
    configureServer(server) {
      if (!withCatalog) return;
      // Dev: the editor reads the catalog from memory (always the current sources).
      server.middlewares.use('/copy-catalog.json', (_req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(catalog().catalog));
      });
    },
    generateBundle(_opts, bundle) {
      if (!withCatalog) return;
      const { catalog: c, errors } = catalog();
      if (errors.length) this.error(`lore-copy:\n${errors.map(fmt).join('\n')}`);
      pruneUnshipped(c, bundle, server);
      this.emitFile({ type: 'asset', fileName: 'copy-catalog.json', source: JSON.stringify(c) });
    },
  };
}
