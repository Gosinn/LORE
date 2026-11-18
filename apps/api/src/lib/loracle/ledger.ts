// The ledger: what the scouts found, settled by code before the stone draws.
//
// - Parses the scouts' dossier lines (R… and K…), drops malformed ones.
// - Keeps only URLs the web tools actually returned (`SeenUrls`), canonicalised, with Wikipedia
//   mirrors folded to Wikipedia itself. A note whose URL was never seen is dropped.
// - One S number per page; places spelled several ways become one place; duplicate notes merge.
// - A VERIFIED note whose newest source is more than two years old becomes STALE.
// - Marks: the weakest status of the notes a line rests on.
import type { LedgerNote, LedgerRecord } from './types.ts';
import type { Mark, MarkStatus, QuestSource } from '#shared';

// ---------------------------------------------------------------------------
// URLs

/** Hosts that copy Wikipedia; never cited, folded back to Wikipedia. */
export const MIRROR_DOMAINS = ['wikiwand.com', 'wikiless.org', 'cavac.at', 'wiki2.org', 'wikizero.com', 'kiwix.org'];

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|amp|_hsenc|_hsmi|spm)$/i;

function wikiTitle(host: string, path: string, params: URLSearchParams): { lang: string; title: string } | null {
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s).replace(/ /g, '_');
    } catch {
      return s.replace(/ /g, '_');
    }
  };
  let m = /^(?:([a-z-]{2,12})\.)?(?:m\.)?wikipedia\.(?:org|com)$/.exec(host);
  if (m) {
    const t = /^\/wiki\/(.+)$/.exec(path);
    if (!t) return null;
    const lang = m[1] && m[1] !== 'www' ? m[1] : 'en';
    return { lang, title: decode(t[1]!) };
  }
  if (host === 'wikiwand.com') {
    m = /^\/([a-z-]{2,12})\/(?:articles\/)?(.+)$/.exec(path);
    if (m) return { lang: m[1]!, title: decode(m[2]!) };
    return null;
  }
  if (host === 'wikiless.org') {
    m = /^\/wiki\/(.+)$/.exec(path);
    if (m) return { lang: params.get('lang') || 'en', title: decode(m[1]!) };
  }
  return null;
}

interface ParsedUrl {
  /** Scheme-less, www-less, tracking-free key used to compare URLs. */
  key: string;
  /** The URL to show: Wikipedia for mirrors, else the original minus tracking and fragment. */
  display: string;
  host: string;
}

export function parseUrl(raw: string): ParsedUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/[).,;:'"]+$/, ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|amp)\./, '');
  const wiki = wikiTitle(host, u.pathname, u.searchParams);
  if (wiki) {
    const title = wiki.title.replace(/_+$/, '');
    const wikiHost = `${wiki.lang}.wikipedia.org`;
    return {
      key: `${wikiHost}/wiki/${title}`,
      display: `https://${wikiHost}/wiki/${encodeURI(title)}`,
      host: wikiHost,
    };
  }
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  u.hash = '';
  let path = u.pathname.replace(/\/amp\/?$/i, '/').replace(/^\/amp\//i, '/').replace(/\.amp$/i, '');
  path = path.replace(/\/+$/, '');
  const qs = u.searchParams.toString();
  const keyHost = host;
  u.pathname = path || '/';
  return {
    key: `${keyHost}${path}${qs ? `?${qs}` : ''}`,
    display: u.toString(),
    host: u.hostname.toLowerCase().replace(/^www\./, ''),
  };
}

export const canonicalUrl = (raw: string) => parseUrl(raw)?.key ?? null;

/** "2 days ago" → null; "April 30, 2025" → "2025-04-30"; "2023" → "2023". */
export function sourceDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === '-') return null;
  const iso = /\b((?:19|20)\d{2})-(\d{2})(?:-(\d{2}))?\b/.exec(s);
  if (iso) return iso[3] ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${iso[1]}-${iso[2]}`;
  if (/[a-z]/i.test(s) && /\b(19|20)\d{2}\b/.test(s)) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      const d = new Date(t);
      // Only trust the parse when it kept the year and a day of month appears in the text.
      if (/\b\d{1,2}\b/.test(s.replace(/\b(19|20)\d{2}\b/, ''))) return d.toISOString().slice(0, 10);
    }
  }
  const y = /\b((?:19|20)\d{2})\b/.exec(s);
  return y ? y[1]! : null;
}

const yearOf = (date: string | null) => (date ? date.slice(0, 4) : null);

export interface SeenUrl {
  url: string;
  key: string;
  host: string;
  title: string | null;
  date: string | null;
  /** True when the stone opened the page (web_fetch); false when it was only seen in search. */
  opened: boolean;
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\])}]+/g;

/**
 * Every URL the web tools returned. Deep-walks tool-result blocks (dynamic filtering may wrap
 * results differently; unverified) and text citations. The model's own words are never a source.
 */
export class SeenUrls {
  private byKey = new Map<string, SeenUrl>();

  add(raw: string, info: { title?: string | null; date?: string | null; opened?: boolean } = {}): void {
    const p = parseUrl(raw);
    if (!p) return;
    const prev = this.byKey.get(p.key);
    const title = info.title?.trim() || null;
    const date = sourceDate(info.date ?? null);
    if (prev) {
      prev.opened ||= info.opened ?? false;
      prev.title ??= title;
      prev.date ??= date;
      return;
    }
    this.byKey.set(p.key, { url: p.display, key: p.key, host: p.host, title, date, opened: info.opened ?? false });
  }

  /** Collect from one response content block. */
  collect(block: unknown): void {
    if (!block || typeof block !== 'object') return;
    const b = block as { type?: unknown; citations?: unknown };
    if (b.type === 'text') {
      if (Array.isArray(b.citations)) for (const c of b.citations) this.walk(c, false, 0);
      return;
    }
    if (typeof b.type === 'string' && b.type.endsWith('_tool_result')) {
      this.walk(block, b.type === 'web_fetch_tool_result', 0);
    }
  }

  private walk(node: unknown, opened: boolean, depth: number): void {
    if (depth > 12 || node == null) return;
    if (typeof node === 'string') {
      // Code-execution output from dynamic filtering may carry result URLs as plain text.
      if (node.length < 200_000) for (const m of node.match(URL_IN_TEXT) ?? []) this.add(m);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) this.walk(n, opened, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.type === 'document') return; // a fetched page's own text: its links were never looked at
    if (typeof o.url === 'string') {
      const isFetch = o.type === 'web_fetch_result';
      const content = o.content as { title?: unknown } | undefined;
      const title =
        typeof o.title === 'string' ? o.title : isFetch && content && typeof content.title === 'string' ? content.title : null;
      const date =
        typeof o.page_age === 'string' ? o.page_age : typeof o.retrieved_at === 'string' && !isFetch ? o.retrieved_at : null;
      this.add(o.url, { title, date, opened: opened && isFetch });
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'url' || k === 'encrypted_content' || k === 'encrypted_index') continue;
      if (typeof v === 'string') {
        if (k === 'stdout' || k === 'text' || k === 'content') this.walk(v, opened, depth + 1);
      } else if (v && typeof v === 'object') this.walk(v, opened, depth + 1);
    }
  }

  get(raw: string): SeenUrl | undefined {
    const key = canonicalUrl(raw);
    return key ? this.byKey.get(key) : undefined;
  }

  has(raw: string): boolean {
    return this.get(raw) !== undefined;
  }

  hosts(): Set<string> {
    return new Set([...this.byKey.values()].map((s) => s.host));
  }

  list(): SeenUrl[] {
    return [...this.byKey.values()];
  }

  get size(): number {
    return this.byKey.size;
  }
}

// ---------------------------------------------------------------------------
// Names and places

/** Fold a name for comparison: no diacritics, ph→p, bh→b, th→t, no "the", spaces, hyphens or punctuation. */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\bthe\b/g, ' ')
    .replace(/ph/g, 'p')
    .replace(/bh/g, 'b')
    .replace(/th/g, 't')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Two folded names are one place: equal, or one letter apart when long (transliterations). */
export function samePlace(a: string, b: string): boolean {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const digits = (s: string) => s.replace(/\D/g, '');
  return Math.min(fa.length, fb.length) >= 7 && fa[0] === fb[0] && digits(fa) === digits(fb) && editDistanceAtMost1(fa, fb);
}

// ---------------------------------------------------------------------------
// Dossiers

const STATUSES: Record<string, MarkStatus> = {
  VERIFIED: 'verified',
  REPORTED: 'reported',
  STALE: 'stale',
  CLOSED: 'closed',
  DISPUTED: 'disputed',
};

export interface DossierLine {
  id: string;
  kind: string;
  name: string | null;
  place: string | null;
  coords: { lat: number; lon: number } | null;
  text: string;
  /** null for "checked, no names" lines (status "-"). */
  status: MarkStatus | null;
  url: string;
  date: string | null;
}

const dash = (s: string | undefined) => {
  const t = (s ?? '').trim();
  return !t || t === '-' || t === '—' ? null : t;
};

function parseCoords(s: string | undefined): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s ?? '');
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/** Parse one dossier: its finding lines and its GAPS. Malformed lines are dropped. */
export function parseDossier(text: string): { lines: DossierLine[]; gaps: string[] } {
  const lines: DossierLine[] = [];
  const gaps: string[] = [];
  let inGaps = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*•]\s*/, '').trim();
    if (!line) continue;
    const g = /^GAPS\s*:\s*(.*)$/i.exec(line);
    if (g) {
      inGaps = true;
      gaps.push(...splitGaps(g[1]!));
      continue;
    }
    let parts = line.split('|').map((p) => p.trim());
    const id = (parts[0] ?? '').replace(/[*_`.:]/g, '');
    if (/^[RKD]\d{1,3}$/i.test(id) && parts.length >= 9) {
      inGaps = false;
      // A '|' inside the finding itself: keep the fields at both ends, join the middle back.
      if (parts.length > 9) parts = [...parts.slice(0, 5), parts.slice(5, -3).join(' / '), ...parts.slice(-3)];
      const statusRaw = (parts[6] ?? '').toUpperCase().split(/\s+/)[0] ?? '';
      const text = dash(parts[5]);
      const url = (parts[7] ?? '').replace(/^<|>$/g, '').trim();
      if (!text || !/^https?:\/\//i.test(url)) continue;
      const status = STATUSES[statusRaw] ?? null;
      const noNames = /^checked,?\s*no names$/i.test(text);
      if (!status && !noNames) continue;
      lines.push({
        id: id.toUpperCase(),
        kind: (parts[1] ?? '').toLowerCase().trim() || 'detail',
        name: dash(parts[2]),
        place: dash(parts[3]),
        coords: parseCoords(parts[4]),
        text,
        status,
        url,
        date: sourceDate(parts[8]),
      });
      continue;
    }
    if (inGaps) gaps.push(...splitGaps(line));
  }
  return { lines, gaps };
}

function splitGaps(s: string): string[] {
  const t = s.trim();
  if (!t || t === '-' || /^none\.?$/i.test(t)) return [];
  const parts = t.match(/[^?]+\?/g);
  return (parts ?? [t]).map((p) => p.trim().replace(/^[;,.\s]+/, '')).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The ledger

export interface Ledger {
  notes: LedgerNote[];
  gaps: string[];
  /** S1… in order of first use. */
  sources: QuestSource[];
  /** Coordinates a note's source gave, by note id. */
  coords: Record<string, { lat: number; lon: number }>;
  /** Canonical place name → its other spellings. */
  aka: Record<string, string[]>;
  /** Places whose crew or staff page was opened and named nobody (folded venue names). */
  noNames: string[];
  /** The <ledger> block for the compose turn. */
  text: string;
}

const RANK: Record<MarkStatus, number> = { verified: 0, reported: 1, stale: 2, disputed: 3, closed: 4 };

const venueOf = (place: string | null) => (place ? place.split(',')[0]!.trim() : null);

function yearsBefore(dateIso: string, todayIso: string): number {
  const y = Number(dateIso.slice(0, 4));
  const m = dateIso.length >= 7 ? Number(dateIso.slice(5, 7)) : 12;
  const ty = Number(todayIso.slice(0, 4));
  const tm = Number(todayIso.slice(5, 7));
  return ty - y + (tm - m) / 12;
}

/**
 * Settle the dossiers into a ledger. `todayIso` decides what is stale. Lines whose URL the tools
 * never returned are dropped; so are lines that merge into an earlier one (their sources join it).
 */
export function buildLedger(dossiers: readonly string[], seen: SeenUrls, todayIso: string): Ledger {
  const all: DossierLine[] = [];
  const gaps: string[] = [];
  for (const d of dossiers) {
    const parsed = parseDossier(d);
    all.push(...parsed.lines);
    for (const g of parsed.gaps) if (!gaps.some((x) => foldName(x) === foldName(g))) gaps.push(g);
  }

  // Places: the first spelling wins, the rest become aka.
  const canon: string[] = [];
  const aka: Record<string, string[]> = {};
  const canonical = (venue: string) => {
    const hit = canon.find((c) => samePlace(c, venue));
    if (hit) {
      if (hit !== venue && !(aka[hit] ??= []).includes(venue)) aka[hit]!.push(venue);
      return hit;
    }
    canon.push(venue);
    return venue;
  };

  // Sources: one S per page actually seen.
  const sources: QuestSource[] = [];
  const sourceByKey = new Map<string, QuestSource>();
  const sourceFor = (url: string, noteDate: string | null): QuestSource | null => {
    const s = seen.get(url);
    if (!s) return null;
    let src = sourceByKey.get(s.key);
    if (!src) {
      src = { n: sources.length + 1, title: s.title ?? s.host, url: s.url, host: s.host, date: noteDate ?? s.date, opened: s.opened };
      sources.push(src);
      sourceByKey.set(s.key, src);
    } else if (!src.date && noteDate) src.date = noteDate;
    return src;
  };

  interface Draft {
    kind: string;
    name: string | null;
    place: string | null;
    text: string;
    statuses: MarkStatus[];
    dates: string[];
    sources: number[];
    coords: { lat: number; lon: number } | null;
  }
  const merged: Draft[] = [];
  const noNames = new Set<string>();

  for (const line of all) {
    const src = sourceFor(line.url, line.date);
    if (!src) continue;
    let place = line.place;
    const venue = venueOf(place);
    if (venue && place) {
      const c = canonical(venue);
      place = c + place.slice(place.indexOf(venue) + venue.length);
    }
    if (line.kind === 'place' && line.name) line.name = canonical(line.name);
    if (!line.status) {
      // "checked, no names": the place has no names to give.
      if (venue) noNames.add(foldName(venueOf(place) ?? venue));
      continue;
    }
    const key = (d: { kind: string; name: string | null; place: string | null }) =>
      `${d.kind}|${foldName(d.name ?? '')}|${foldName(venueOf(d.place) ?? '')}`;
    const k = key({ kind: line.kind, name: line.name, place });
    const twin = merged.find((m) => key(m) === k && (m.name || m.place));
    const date = line.date ?? src.date;
    if (twin) {
      twin.statuses.push(line.status);
      if (date) twin.dates.push(date);
      if (!twin.sources.includes(src.n)) twin.sources.push(src.n);
      twin.coords ??= line.coords;
      continue;
    }
    merged.push({
      kind: line.kind,
      name: line.name,
      place,
      text: line.text,
      statuses: [line.status],
      dates: date ? [date] : [],
      sources: [src.n],
      coords: line.coords,
    });
  }

  const notes: LedgerNote[] = [];
  const coords: Record<string, { lat: number; lon: number }> = {};
  for (const m of merged) {
    // A shut door outweighs an open one; disagreement outweighs certainty; else the surest reading.
    let status: MarkStatus = m.statuses.includes('closed')
      ? 'closed'
      : m.statuses.includes('disputed')
        ? 'disputed'
        : m.statuses.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
    const newest = m.dates.slice().sort().at(-1) ?? null;
    if (status === 'verified' && newest && yearsBefore(newest, todayIso) > 2) status = 'stale';
    const id = `N${notes.length + 1}`;
    notes.push({
      id,
      kind: m.kind,
      name: m.name,
      place: m.place,
      text: m.text,
      status,
      year: status === 'stale' ? yearOf(newest) : null,
      sources: m.sources.sort((a, b) => a - b),
    });
    if (m.coords && status !== 'disputed') coords[id] = m.coords;
  }

  const ledger: Ledger = { notes, gaps, sources, coords, aka, noNames: [...noNames], text: '' };
  ledger.text = ledgerText(ledger);
  return ledger;
}

/** The <ledger> block the compose turn reads. */
export function ledgerText(ledger: Pick<Ledger, 'notes' | 'gaps' | 'sources' | 'coords' | 'aka' | 'noNames'>): string {
  const out: string[] = [];
  for (const s of ledger.sources) {
    out.push(`S${s.n} | ${s.title.replace(/\|/g, '/')} | ${s.url} | ${s.date ?? '-'} | ${s.opened ? 'opened' : 'seen'}`);
  }
  for (const n of ledger.notes) {
    const c = ledger.coords[n.id];
    const status = n.status.toUpperCase() + (n.status === 'stale' && n.year ? ` ${n.year}` : '');
    out.push(
      [
        n.id,
        n.kind,
        n.name ?? '-',
        n.place ?? '-',
        c ? `${c.lat},${c.lon}` : '-',
        n.text.replace(/\|/g, '/'),
        status,
        n.sources.map((x) => `S${x}`).join(','),
      ].join(' | '),
    );
  }
  for (const [place, variants] of Object.entries(ledger.aka)) out.push(`AKA | ${place} | ${variants.join(' / ')}`);
  for (const p of ledger.noNames) out.push(`NO NAMES | ${p} | checked, no names`);
  out.push('GAPS:');
  for (const g of ledger.gaps) out.push(`- ${g}`);
  return out.join('\n');
}

/** What is kept on the wish (`wishes.ledger`): notes, gaps and the raw dossiers. Export drops the dossiers. */
export function ledgerRecord(ledger: Ledger, dossiers: readonly string[]): LedgerRecord {
  return { notes: ledger.notes, gaps: ledger.gaps, dossiers: [...dossiers] };
}

// ---------------------------------------------------------------------------
// Marks and signs

/**
 * A mark from the notes a line rests on: the weakest status wins (verified < reported < stale <
 * disputed < closed); a stale mark carries the oldest year; sources are the S numbers.
 * null when the line rests on no known note.
 */
export function markOf(noteIds: readonly string[], notes: readonly LedgerNote[]): Mark | null {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const cited = noteIds.map((id) => byId.get(id)).filter((n): n is LedgerNote => !!n);
  if (cited.length === 0) return null;
  let status: MarkStatus = 'verified';
  for (const n of cited) if (RANK[n.status] > RANK[status]) status = n.status;
  const years = cited.filter((n) => n.status === 'stale' && n.year).map((n) => n.year!);
  const sources = [...new Set(cited.flatMap((n) => n.sources))].sort((a, b) => a - b);
  return { status, year: status === 'stale' ? (years.sort()[0] ?? null) : null, sources };
}

/** Whether the ledger holds a name that keeps coming up (a person in 2+ notes or 2+ sources). */
export function nameKeepsComingUp(notes: readonly LedgerNote[]): boolean {
  const count = new Map<string, number>();
  for (const n of notes) {
    if (n.kind !== 'person' || !n.name) continue;
    const k = foldName(n.name);
    count.set(k, (count.get(k) ?? 0) + Math.max(1, n.sources.length));
  }
  for (const n of notes) {
    if (n.kind === 'person' || !n.name) continue;
    const k = foldName(n.name);
    if (count.has(k)) count.set(k, count.get(k)! + 1);
  }
  return [...count.values()].some((c) => c >= 2);
}

/** Whether the ledger weighs a cost or a gate. */
export const weighsCost = (notes: readonly LedgerNote[]) => notes.some((n) => n.kind === 'cost' || n.kind === 'gate');
