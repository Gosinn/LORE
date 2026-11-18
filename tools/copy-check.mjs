#!/usr/bin/env node
// npm run copy:check [-- --base <ref>] [--server <url>] [--offline] [--json]
//
// Live text (LIVE_TEXT_SPEC.md 13, R2): the owner rewords LORE from the app, and each edit is keyed by
// the default text in the code. Changing a default in code changes its key, so the live edit stops
// applying (it becomes an "orphan"). This lists the live edits a code change would orphan, before it
// ships: it collects every text key at <base> (default HEAD) and in the working tree, then reads the
// public GET /api/copy from the live server.
//
//   orphaned  the edit stops showing: keep the owner's words (write them into the code), or tell him.
//   moved     same words, new file: the server follows the edit by itself after the deploy.
//   baked     the owner's words are now the default in the code: he can clean the edit up in the app.
//
// Exit code 1 when an edit would be orphaned; 0 otherwise (also when the server can't be reached).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  analyzeFile,
  buildCatalog,
  collectWeb,
  fileInfo,
  isCopyMachinery,
  listServerSources,
  REPO,
  scanServerMessages,
  SERVER_SOURCES,
} from '../apps/web/vite/collect.ts';

const LEGAL = ['pages/Legal'];
const DEFAULT_SERVER = 'https://lore-g8co.onrender.com';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const base = opt('--base', 'HEAD');
const server = (opt('--server', process.env.LORE_SERVER ?? DEFAULT_SERVER) ?? '').replace(/\/$/, '');
const offline = args.includes('--offline');
const asJson = args.includes('--json');

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Every copy key at a git ref: web sources, the vocabulary, static server messages. */
function catalogAt(ref) {
  const paths = git('ls-tree', '-r', '--name-only', ref, '--', 'apps/web/src', 'packages/shared/src', 'apps/api/src').split('\n').filter(Boolean);
  const occurrences = [];
  const serverFiles = [];
  const serverRoots = SERVER_SOURCES.map((p) => p.slice(REPO.length + 1));
  for (const p of paths) {
    const abs = `${REPO}/${p}`;
    const info = fileInfo(abs, { legal: LEGAL });
    if (info && !isCopyMachinery(abs)) occurrences.push(...analyzeFile(git('show', `${ref}:${p}`), info).occurrences);
    if (/\.ts$/.test(p) && serverRoots.some((r) => p === r || p.startsWith(`${r}/`))) serverFiles.push({ file: abs, code: git('show', `${ref}:${p}`) });
  }
  occurrences.push(...scanServerMessages(serverFiles).occurrences);
  return buildCatalog(occurrences, ref).catalog;
}

function catalogNow() {
  const occurrences = collectWeb({ legal: LEGAL }).flatMap((r) => r.analysis.occurrences);
  const files = listServerSources().map((file) => ({ file, code: readFileSync(file, 'utf8') }));
  occurrences.push(...scanServerMessages(files).occurrences);
  return buildCatalog(occurrences, 'working tree').catalog;
}

const before = catalogAt(base);
const now = catalogNow();
const removed = Object.keys(before.keys).filter((k) => !now.keys[k]);
const added = Object.keys(now.keys).filter((k) => !before.keys[k]);

let live = null;
let liveError = null;
if (!offline && removed.length) {
  try {
    const res = await fetch(`${server}/api/copy`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    live = (await res.json()).texts ?? {};
  } catch (err) {
    liveError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * JSON with every invisible or format character as a \u escape (same as copyEditor/bake.ts): the live
 * words come from the server, and hidden characters in them must never reach a code session as text.
 */
const visibleJson = (value, indent) =>
  JSON.stringify(value, null, indent).replace(
    /[\p{Cf}\p{Zl}\p{Zp}\u007F-\u009F\u034F\u115F\u1160\u17B4\u17B5\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu,
    (c) => c.split('').map((u) => `\\u${u.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
  );

const scopeOf = (k) => k.slice(0, k.lastIndexOf('#'));
const findings = [];
for (const key of removed) {
  const words = live?.[key];
  if (words === undefined) continue;
  const old = before.keys[key];
  const scope = scopeOf(key);
  const baked = Object.entries(now.keys).some(([k, e]) => scopeOf(k) === scope && e.text === words);
  const moved = Object.entries(now.keys).filter(([k, e]) => e.text === old.text && !live[k]);
  const status = baked ? 'baked' : moved.length === 1 ? 'moved' : 'orphaned';
  findings.push({ status, key, at: old.at, default: old.text, live: words, to: status === 'moved' ? moved[0][0] : undefined });
}

if (asJson) {
  console.log(visibleJson({ base, server: offline ? null : server, removed: removed.length, added: added.length, liveError, findings }, 2));
} else {
  console.log(`copy:check  ${base} → working tree: ${removed.length} text key(s) gone, ${added.length} new.`);
  if (!removed.length) console.log('No text this change touches can carry a live edit.');
  else if (offline) console.log('Offline: live edits not checked.');
  else if (liveError) console.log(`Couldn't read live edits from ${server} (${liveError}). Run again when it answers.`);
  else if (!findings.length) console.log(`None of them has a live edit on ${server}.`);
  for (const f of findings) {
    console.log(`\n[${f.status}] ${f.at.join(', ')}  (${f.key})`);
    console.log(`  code was: ${visibleJson(f.default)}`);
    console.log(`  live:     ${visibleJson(f.live)}`);
    if (f.status === 'moved') console.log(`  follows to ${f.to} after the deploy.`);
    if (f.status === 'baked') console.log('  already in the code: the owner can clean it up in Edited texts.');
    if (f.status === 'orphaned') console.log('  this edit will stop showing: keep the owner\'s words in the new text, or tell him.');
  }
}
process.exitCode = findings.some((f) => f.status === 'orphaned') ? 1 : 0;
