// The checks: code that reads every draft before it becomes a scroll.
//
// Soft faults are fixed here and only logged (S1–S14). Hard faults earn one repair call; what
// remains after it makes the road `rough` (H1–H17). Safety faults block the road: one repair, then
// one fresh compose, then the road fades (X1–X6).
//
// Shown fields: title, calling, truth, waypoint name, clue, trial, earns, mystery, step text,
// provision text, this week, rule. Fault codes (never text) go to the log; the fault lines (which
// may quote the draft) go only into the repair turn.
import type { LoracleTag } from '#shared';
import { foldName, markOf, samePlace, type Ledger, type SeenUrls } from './ledger.ts';
import {
  BANNED,
  CLUE_LOGISTICS,
  FILLER,
  HEDGES,
  MACHINERY,
  MYSTERY_TEMPLATE,
  PLACEHOLDER,
  PLACEHOLDERS,
  STOCK,
  STUBBORN,
  countryName,
} from './prompts.ts';
import type { LineDraftT, QuestDraftT, StepDraftT, WaypointDraftT } from './schema.ts';
import type { Weighing } from './types.ts';

export interface Fault {
  /** "H3", "X1", … */
  code: string;
  /** Where, without draft text: "calling", "waypoint 2 clue". Safe to log. */
  at: string;
  /** For the repair turn only (may quote the draft). Never logged. */
  detail: string;
}

export interface CheckContext {
  ledger: Ledger;
  weighing: Pick<Weighing, 'tags' | 'binds'>;
  /** The wish text (for X5 and "again/back/still"); never logged. */
  wishText: string;
  /** The realm's ISO country code. */
  homeCountry: string;
  todayIso: string;
  seen: SeenUrls;
}

export interface CheckResult {
  draft: QuestDraftT;
  /** Soft fixes made, as codes ("S4 waypoint 1 step 2"). */
  soft: string[];
  hard: Fault[];
  safety: Fault[];
}

// ---------------------------------------------------------------------------
// Text helpers

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase();

const wordCount = (s: string | null | undefined) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const phraseRes = new Map<string, RegExp>();
function phraseRe(phrase: string): RegExp {
  let re = phraseRes.get(phrase);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(norm(phrase)).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'u');
    phraseRes.set(phrase, re);
  }
  return re;
}

/** The first phrase of `list` in `text`, ignoring any proper name from the ledger that contains it. */
export function findPhrase(text: string, list: readonly string[], exempt: readonly string[] = []): string | null {
  let t = norm(text);
  for (const name of exempt) if (name.length > 3) t = t.split(norm(name)).join(' ');
  for (const p of list) if (phraseRe(p).test(t)) return p;
  return null;
}

/** Does `text` mention `name`? Whole name, or (for a two-word name) its last word of 4+ letters. */
export function mentions(text: string, name: string | null | undefined): boolean {
  if (!name) return false;
  const t = ` ${norm(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const n = norm(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!n) return false;
  if (t.includes(` ${n} `)) return true;
  const parts = n.split(' ');
  const last = parts.at(-1)!;
  return parts.length >= 2 && last.length >= 4 && t.includes(` ${last} `);
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/gu;

const venueOf = (place: string) => place.split(',')[0]!.trim();

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'unitedstates',
  us: 'unitedstates',
  unitedstatesofamerica: 'unitedstates',
  uk: 'unitedkingdom',
  greatbritain: 'unitedkingdom',
  britain: 'unitedkingdom',
  england: 'unitedkingdom',
  scotland: 'unitedkingdom',
  wales: 'unitedkingdom',
  northernireland: 'unitedkingdom',
  burma: 'myanmar',
  czechrepublic: 'czechia',
  holland: 'netherlands',
  turkiye: 'turkey',
};
const countryKey = (s: string) => {
  const f = foldName(s);
  return COUNTRY_ALIASES[f] ?? f;
};

export function sameCountry(country: string, homeIso: string): boolean {
  const c = country.trim();
  if (c.toUpperCase() === homeIso.toUpperCase()) return true;
  return countryKey(c) === countryKey(countryName(homeIso));
}

// ---------------------------------------------------------------------------
// Numbers (S5)

interface Num {
  digits: string;
  value: number;
}

function numbersIn(text: string): Num[] {
  const out: Num[] = [];
  for (const m of text.matchAll(/\d+(?:[.,  ]\d{3})*(?:[.,]\d+)?/g)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    const value = Number(raw.replace(/[,  ](?=\d{3}\b)/g, '').replace(',', '.'));
    out.push({ digits, value: Number.isFinite(value) ? value : Number(digits) });
  }
  return out;
}

function numberBacked(n: Num, pool: Num[]): boolean {
  if (pool.some((p) => p.digits === n.digits || p.value === n.value)) return true;
  const values = pool.map((p) => p.value).filter((v) => v > 0);
  for (const v of values) for (let k = 2; k <= 9; k++) if (Math.abs(v * k - n.value) < 1e-9) return true;
  const capped = values.slice(0, 24);
  for (let i = 0; i < capped.length; i++)
    for (let j = i + 1; j < capped.length; j++) {
      if (Math.abs(capped[i]! + capped[j]! - n.value) < 1e-9) return true;
      for (let k = j + 1; k < capped.length; k++)
        if (Math.abs(capped[i]! + capped[j]! + capped[k]! - n.value) < 1e-9) return true;
    }
  return false;
}

// ---------------------------------------------------------------------------
// The checks

const STEP_ORDER: Record<StepDraftT['kind'], number> = { help: 0, gate: 1, cost: 2, do: 3 };
const PROVISION_ORDER = ['body', 'papers', 'coin', 'tongue', 'skills'] as const;
const CAPS = { calling: 40, truth: 14, clue: 14, trial: 35, mystery: 18, step: 20, line: 20, thisWeek: 30, rule: 30, earns: 8 };
const over = (s: string | null | undefined, cap: number) => wordCount(s) > cap * 1.25;

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +(iso.slice(8, 10) || '1')) / DAY_MS;

const COMBAT = /\b(fight\w*|bouts?|spar\w*|knock\w*|lethwei|muay thai|boxing|box|mma|kickbox\w*|cage|ring)\b/i;
const OPEN_OCEAN = /\b(open ocean|ocean crossing|offshore|transatlantic|transpacific|cross(ing)? the (atlantic|pacific|indian ocean)|solo sail\w*)\b/i;
const YOUTH_SAFE = /\b(youth|junior|juniors|under-?18|cadet|licensed)\b/i;
const SOLO = /\b(alone|solo|by yourself|on your own)\b/i;
const PESTER = /\b(again and again|every (day|week|month)|each (day|week|month)|keep (writing|calling|asking|emailing)|camp (beside|outside|near|by)|wait outside|sleep outside)\b/i;
const ALL_TRAVEL = /\b(against all (but essential )?travel|avoid all (but essential )?travel|do not travel|level 4)\b/i;
const FIRST_WHEN = /\b(tonight|today|tomorrow|this (week|weekend)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/**
 * Check (and softly fix) a draft. The draft passed in is not changed; the fixed copy is returned.
 */
export function checkDraft(input: QuestDraftT, ctx: CheckContext): CheckResult {
  const draft: QuestDraftT = structuredClone(input);
  const soft: string[] = [];
  const hard: Fault[] = [];
  const safety: Fault[] = [];
  const { ledger } = ctx;
  const notes = new Map(ledger.notes.map((n) => [n.id, n]));
  const tags = new Set<LoracleTag>(ctx.weighing.tags);
  const ledgerNames = [
    ...new Set(
      ledger.notes
        .flatMap((n) => [n.name, n.place ? venueOf(n.place) : null])
        .filter((s): s is string => !!s && s.length > 3),
    ),
  ];
  const personNotes = ledger.notes.filter((n) => n.kind === 'person' && n.name);
  const hostSeen = (host: string) => {
    const h = host.toLowerCase().replace(/^www\./, '');
    const hosts = ctx.seen.hosts();
    return [...hosts].some((s) => s === h || s.endsWith(`.${h}`) || h.endsWith(`.${s}`));
  };
  const hardF = (code: string, at: string, detail: string) => hard.push({ code, at, detail });
  const safeF = (code: string, at: string, detail: string) => safety.push({ code, at, detail });
  const wp = (i: number, w: WaypointDraftT) => `Waypoint ${i + 1} (${w.name})`;

  // S14: no exclamation marks or emoji in any shown field (fixed in place).
  const tidy = (s: string) => s.replace(EMOJI, '').replace(/!+/g, '.').replace(/\s{2,}/g, ' ').trim();
  const tidyNullable = (s: string | null) => (s === null ? null : tidy(s));
  let tidied = false;
  const t0 = JSON.stringify(draft);
  draft.title = tidy(draft.title);
  draft.calling = tidy(draft.calling);
  draft.truth = tidyNullable(draft.truth);
  draft.rule = tidyNullable(draft.rule);
  draft.thisWeek.text = tidy(draft.thisWeek.text);
  for (const w of draft.map) {
    w.name = tidy(w.name);
    w.clue = tidy(w.clue);
    w.trial = tidy(w.trial);
    w.earns = tidyNullable(w.earns);
    w.mystery = tidyNullable(w.mystery);
    for (const s of w.road) s.text = tidy(s.text);
  }
  for (const g of PROVISION_ORDER) for (const l of draft.provisions[g]) l.text = tidy(l.text);
  if (JSON.stringify(draft) !== t0) tidied = true;
  if (tidied) soft.push('S14 tidy');

  // S1: unknown note ids are removed.
  const known = (ids: string[], at: string) => {
    const kept = ids.filter((id) => notes.has(id));
    if (kept.length !== ids.length) soft.push(`S1 ${at}`);
    return [...new Set(kept)];
  };
  draft.map.forEach((w, i) => {
    w.noteIds = known(w.noteIds, `waypoint ${i + 1}`);
    w.road.forEach((s, j) => (s.noteIds = known(s.noteIds, `waypoint ${i + 1} step ${j + 1}`)));
    if (w.person?.noteId && !notes.has(w.person.noteId)) {
      w.person.noteId = null;
      soft.push(`S1 waypoint ${i + 1} person`);
    }
  });
  draft.thisWeek.noteIds = known(draft.thisWeek.noteIds, 'this week');
  for (const g of PROVISION_ORDER) draft.provisions[g].forEach((l, j) => (l.noteIds = known(l.noteIds, `${g} ${j + 1}`)));

  // S9: a person's note is the one that names them.
  draft.map.forEach((w, i) => {
    const p = w.person;
    if (!p?.name) return;
    const current = p.noteId ? notes.get(p.noteId) : undefined;
    if (current?.kind === 'person' && (mentions(current.name ?? '', p.name) || mentions(p.name, current.name))) return;
    const match = personNotes.find((n) => mentions(n.name!, p.name) || mentions(p.name!, n.name));
    if ((match?.id ?? null) !== p.noteId) {
      p.noteId = match?.id ?? null;
      soft.push(`S9 waypoint ${i + 1}`);
    }
  });

  // S10: one legend clue at most.
  let lore = 0;
  draft.map.forEach((w, i) => {
    if (w.lore && ++lore > 1) {
      w.lore = false;
      soft.push(`S10 waypoint ${i + 1}`);
    }
  });

  // S13: a mystery that only restates a gap, with no place, becomes a question asked at the place.
  draft.map.forEach((w, i) => {
    if (!w.mystery) return;
    const m = foldName(w.mystery);
    const gap = ledger.gaps.find((g) => foldName(g) === m || (m.length > 12 && foldName(g).includes(m)));
    if (gap && !mentions(w.mystery, venueOf(w.where.place)) && !mentions(w.mystery, w.where.town)) {
      w.road.push({ kind: 'do', text: `Ask at ${venueOf(w.where.place)}: ${gap.replace(/\s+/g, ' ')}`, noteIds: w.noteIds.slice(0, 2) });
      w.mystery = null;
      soft.push(`S13 waypoint ${i + 1}`);
    }
  });

  // Steps and lines: S2 (cites nothing), S3 (counsel), S4 (hedges, placeholders, stock words),
  // S5 (numbers), S6 (unseen hosts).
  const dropLine = <T extends { text: string; noteIds: string[] }>(item: T, at: string, counsel: boolean): T | null => {
    if (!counsel && item.noteIds.length === 0) {
      soft.push(`S2 ${at}`);
      return null;
    }
    if (findPhrase(item.text, [...HEDGES, ...PLACEHOLDERS], ledgerNames) || PLACEHOLDER.test(item.text)) {
      soft.push(`S4 ${at}`);
      return null;
    }
    if (findPhrase(item.text, [...STOCK, ...FILLER, ...MACHINERY], ledgerNames)) {
      soft.push(`S4 ${at}`);
      return null;
    }
    if (counsel) {
      if (/\d/.test(item.text) || /https?:|www\./i.test(item.text) || ledgerNames.some((n) => mentions(item.text, n))) {
        soft.push(`S3 ${at}`);
        return null;
      }
      return item;
    }
    const cited = item.noteIds.map((id) => notes.get(id)!).filter(Boolean);
    const pool = cited.flatMap((n) => numbersIn(`${n.text} ${n.name ?? ''} ${n.place ?? ''}`));
    const disputed = cited.filter((n) => n.status === 'disputed').flatMap((n) => numbersIn(n.text));
    const ty = Number(ctx.todayIso.slice(0, 4));
    for (const n of numbersIn(item.text)) {
      if (n.value === 0 || n.value === 1) continue;
      if (Number.isInteger(n.value) && n.value >= ty && n.value <= ty + 2) continue;
      if (disputed.some((d) => d.digits === n.digits) || !numberBacked(n, pool)) {
        soft.push(`S5 ${at}`);
        return null;
      }
    }
    // S6: a host the tools never returned is cut with its sentence.
    const hostRe = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s]*)?/gi;
    let text = item.text;
    for (const m of item.text.matchAll(hostRe)) {
      const host = m[1]!;
      if (/^\d/.test(host) || !/[a-z]/i.test(host.split('.').at(-1)!)) continue;
      if (!hostSeen(host)) {
        text = text
          .split(/(?<=[.;])\s+/)
          .filter((sentence) => !sentence.includes(m[0]))
          .join(' ')
          .trim();
        soft.push(`S6 ${at}`);
      }
    }
    if (!text) return null;
    item.text = text;
    return item;
  };

  draft.map.forEach((w, i) => {
    w.road = w.road
      .map((s, j) => dropLine(s, `waypoint ${i + 1} step ${j + 1}`, false))
      .filter((s): s is StepDraftT => s !== null);
  });
  let counsel = 0;
  for (const g of PROVISION_ORDER) {
    draft.provisions[g] = draft.provisions[g]
      .map((l, j) => {
        const kept = dropLine(l, `${g} ${j + 1}`, l.counsel);
        if (kept?.counsel && ++counsel > 2) {
          soft.push(`S3 ${g} ${j + 1}`);
          return null;
        }
        return kept;
      })
      .filter((l): l is LineDraftT => l !== null);
  }

  // S12: a step's notes belong to its waypoint.
  draft.map.forEach((w, i) => {
    w.road = w.road.filter((s, j) => {
      const missing = s.noteIds.filter((id) => !w.noteIds.includes(id));
      if (missing.length === 0) return true;
      const home = draft.map.findIndex((o, k) => k !== i && s.noteIds.every((id) => o.noteIds.includes(id)));
      if (home >= 0) {
        draft.map[home]!.road.push(s);
        soft.push(`S12 waypoint ${i + 1} step ${j + 1} moved`);
        return false;
      }
      w.noteIds.push(...missing);
      soft.push(`S12 waypoint ${i + 1} step ${j + 1}`);
      return true;
    });
  });

  // S8: nothing appears twice. Earlier fields keep their words; a later step or line that repeats a
  // sentence or a run of four words is dropped (runs made only of ledger names are allowed).
  const nameWords = new Set(
    ledgerNames.flatMap((n) => norm(n).split(/[^\p{L}\p{N}]+/u)).concat(['the', 'of', 'at', 'in', 'a', 'to', 'and', 'on']),
  );
  const grams = (s: string) => {
    const w = norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i + 4 <= w.length; i++) {
      const g = w.slice(i, i + 4);
      if (g.every((x) => nameWords.has(x))) continue;
      out.push(g.join(' '));
    }
    return out;
  };
  const seenGrams = new Set<string>();
  const remember = (s: string | null) => s && grams(s).forEach((g) => seenGrams.add(g));
  const repeats = (s: string) => grams(s).some((g) => seenGrams.has(g));
  [draft.title, draft.calling, draft.truth, draft.rule, draft.thisWeek.text].forEach(remember);
  for (const w of draft.map) [w.name, w.clue, w.trial, w.earns, w.mystery].forEach(remember);
  draft.map.forEach((w, i) => {
    w.road = w.road.filter((s, j) => {
      if (repeats(s.text)) {
        soft.push(`S8 waypoint ${i + 1} step ${j + 1}`);
        return false;
      }
      remember(s.text);
      return true;
    });
  });
  for (const g of PROVISION_ORDER) {
    draft.provisions[g] = draft.provisions[g].filter((l, j) => {
      if (repeats(l.text)) {
        soft.push(`S8 ${g} ${j + 1}`);
        return false;
      }
      remember(l.text);
      return true;
    });
  }

  // S7: caps. Four steps a waypoint (help > gate > cost > do); ten provision lines (body > papers > coin > tongue > skills).
  draft.map.forEach((w, i) => {
    if (w.road.length > 4) {
      const keep = new Set(
        w.road
          .map((s, j) => ({ s, j }))
          .sort((a, b) => STEP_ORDER[a.s.kind] - STEP_ORDER[b.s.kind] || a.j - b.j)
          .slice(0, 4)
          .map((x) => x.s),
      );
      w.road = w.road.filter((s) => keep.has(s));
      soft.push(`S7 waypoint ${i + 1}`);
    }
  });
  let budget = 10;
  for (const g of PROVISION_ORDER) {
    const lines = draft.provisions[g];
    if (lines.length > budget) {
      draft.provisions[g] = lines.slice(0, budget);
      soft.push(`S7 ${g}`);
    }
    budget -= draft.provisions[g].length;
  }

  // S11: the span reaches the last dated waypoint.
  const lastAtYear = Math.max(0, ...draft.map.map((w) => (w.at ? Number(w.at.slice(0, 4)) || 0 : 0)));
  const ty = Number(ctx.todayIso.slice(0, 4));
  const spanYears = { days: 1 / 365, weeks: 7 / 365, months: 1 / 12, years: 1 }[draft.span.unit] * draft.span.amount;
  if (lastAtYear && ty + spanYears < lastAtYear) {
    draft.span = { amount: lastAtYear - ty + 1, unit: 'years' };
    soft.push('S11 span');
  }
  draft.span.amount = Math.max(1, Math.round(draft.span.amount));
  draft.thisWeek.minutes = Math.min(60, Math.max(5, Math.round(draft.thisWeek.minutes)));

  // ---- Hard faults -------------------------------------------------------

  const map = draft.map;
  // H17: counts and missing parts.
  if (map.length < 3 || map.length > 7) hardF('H17', 'map', `The map has ${map.length} waypoints; it needs 3 to 7.`);
  if (!draft.title.trim()) hardF('H17', 'title', 'The quest has no title.');
  if (!draft.calling.trim()) hardF('H17', 'calling', 'The quest has no calling.');
  map.forEach((w, i) => {
    if (w.road.length < 2)
      hardF('H17', `waypoint ${i + 1} steps`, `${wp(i, w)} has ${w.road.length} step(s) that hold; it needs 2 to 4, each citing its notes.`);
    if (w.person && (!w.person.verb.trim() || !w.person.role.trim()))
      hardF('H17', `waypoint ${i + 1} person`, `${wp(i, w)}: the person has no ${w.person.verb.trim() ? 'role' : 'verb'}.`);
  });

  // H1: banned words in shown fields.
  const shown: [string, string | null][] = [
    ['title', draft.title],
    ['calling', draft.calling],
    ['truth', draft.truth],
    ['this week', draft.thisWeek.text],
    ['rule', draft.rule],
  ];
  map.forEach((w, i) => {
    shown.push([`waypoint ${i + 1} name`, w.name], [`waypoint ${i + 1} clue`, w.clue], [`waypoint ${i + 1} trial`, w.trial]);
    shown.push([`waypoint ${i + 1} earns`, w.earns], [`waypoint ${i + 1} mystery`, w.mystery]);
  });
  for (const [at, text] of shown) {
    if (!text) continue;
    const hit = findPhrase(text, BANNED, ledgerNames);
    if (hit) hardF('H1', at, `The ${at} uses "${hit}". Say it plainly in the stone's own words.`);
  }

  // H2: placeholders where a place belongs.
  map.forEach((w, i) => {
    for (const [field, text] of [
      ['where', `${w.where.place} ${w.where.town ?? ''} ${w.where.geoQuery}`],
      ['trial', w.trial],
    ] as const) {
      if (PLACEHOLDER.test(text) || findPhrase(text, PLACEHOLDERS))
        hardF('H2', `waypoint ${i + 1} ${field}`, `${wp(i, w)}: the ${field} names a placeholder, not a real place.`);
    }
    if (PLACEHOLDER.test(w.where.place.trim()) || /^(home|a gym|a club|a school|a harbou?r)$/i.test(w.where.place.trim()))
      hardF('H2', `waypoint ${i + 1} where`, `${wp(i, w)}: "${w.where.place}" is a category, not a place.`);
  });
  if (PLACEHOLDER.test(draft.thisWeek.text) || findPhrase(draft.thisWeek.text, PLACEHOLDERS))
    hardF('H2', 'this week', 'This week names a placeholder instead of a real door.');

  // H3: the calling's formula.
  {
    const c = draft.calling;
    const namedPerson = personNotes.find((n) => mentions(c, n.name));
    const namedOther = ledger.notes.find((n) => n.kind !== 'person' && n.kind !== 'place' && n.name && mentions(c, n.name));
    const place = map.some(
      (w) => mentions(c, venueOf(w.where.place)) || mentions(c, w.where.town) || mentions(c, w.where.country),
    );
    if (!namedPerson && !namedOther)
      hardF('H3', 'calling', 'The calling names no person (or ship, crew or team) from the ledger.' + hintPerson(personNotes));
    if (!place) hardF('H3', 'calling', 'The calling names no place from the map.');
    if (!STUBBORN.test(c)) hardF('H3', 'calling', 'The calling has no stubborn condition (until, before, do not leave, refuse, stay).');
    if (namedPerson && !map.some((w) => w.person?.name && (mentions(w.person.name, namedPerson.name) || mentions(namedPerson.name!, w.person.name))))
      hardF('H3', 'calling', `The calling names ${namedPerson.name}, who is the person of no waypoint.`);
  }

  // H4–H6: people.
  const noNames = new Set(ledger.noNames);
  map.forEach((w, i) => {
    if (w.person?.name) return;
    if (noNames.has(foldName(venueOf(w.where.place)))) return;
    const named = personNotes.find(
      (n) => w.noteIds.includes(n.id) || (n.place && samePlace(venueOf(n.place), venueOf(w.where.place))),
    );
    if (named) hardF('H4', `waypoint ${i + 1} person`, `${wp(i, w)} gives a role where the ledger names ${named.name} (${named.id}).`);
  });
  const nameCount = new Map<string, number>();
  let named = 0;
  map.forEach((w, i) => {
    const n = w.person?.name;
    if (!n) return;
    if (/ or |\/|,|&| and /i.test(n)) hardF('H5', `waypoint ${i + 1} person`, `${wp(i, w)}: person.name must hold exactly one human.`);
    else if (!personNotes.some((p) => mentions(p.name!, n) || mentions(n, p.name)))
      hardF('H5', `waypoint ${i + 1} person`, `${wp(i, w)}: "${n}" is in no person note of the ledger.`);
    else named++;
    const key = foldName(n);
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  });
  const usable = new Set(personNotes.filter((n) => n.status !== 'closed').map((n) => foldName(n.name!))).size;
  if (named < Math.min(2, usable)) hardF('H6', 'people', `Only ${named} waypoint(s) name a person; the ledger holds ${usable}. Name real people on at least two.`);
  if ([...nameCount.values()].some((c) => c >= 3)) hardF('H6', 'people', 'One person appears on three or more waypoints; two at most.');

  // H7: mysteries.
  const mysteries = map.map((w, i) => ({ i, m: w.mystery })).filter((x): x is { i: number; m: string } => !!x.m);
  if (mysteries.length === 0) hardF('H7', 'mysteries', 'No waypoint holds a mystery; one to three must, never the first.');
  if (mysteries.length > 3) hardF('H7', 'mysteries', `${mysteries.length} mysteries; three at most.`);
  if (map[0]?.mystery) hardF('H7', 'waypoint 1 mystery', 'The first waypoint holds a mystery; it never may.');
  for (const { i, m } of mysteries) {
    if (MYSTERY_TEMPLATE.test(m)) hardF('H7', `waypoint ${i + 1} mystery`, `${wp(i, map[i]!)}: the mystery is a template.`);
    if (over(m, CAPS.mystery)) hardF('H9', `waypoint ${i + 1} mystery`, `${wp(i, map[i]!)}: the mystery is over ${CAPS.mystery} words.`);
  }
  const tails = mysteries.map(({ m }) => norm(m).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(-3).join(' '));
  if (new Set(tails).size !== tails.length) hardF('H7', 'mysteries', 'Two mysteries end the same way; give each its own shape.');

  // H8: no waypoint rests only on shut doors.
  map.forEach((w, i) => {
    if (w.noteIds.length && w.noteIds.every((id) => notes.get(id)?.status === 'closed'))
      hardF('H8', `waypoint ${i + 1}`, `${wp(i, w)} rests only on closed notes.`);
  });

  // H9: lengths.
  if (over(draft.calling, CAPS.calling)) hardF('H9', 'calling', `The calling is over ${CAPS.calling} words.`);
  if (wordCount(draft.title) > 5 || draft.title.includes(':')) hardF('H9', 'title', 'The title is 1 to 5 words, no colon.');
  map.forEach((w, i) => {
    if (over(w.trial, CAPS.trial)) hardF('H9', `waypoint ${i + 1} trial`, `${wp(i, w)}: the trial is over ${CAPS.trial} words.`);
    if (over(w.clue, CAPS.clue)) hardF('H9', `waypoint ${i + 1} clue`, `${wp(i, w)}: the clue is over ${CAPS.clue} words.`);
  });

  // H10: one gate at most, two walkable waypoints before it, nothing after it dated earlier.
  const gates = map.map((w, i) => (w.kind === 'gate' ? i : -1)).filter((i) => i >= 0);
  if (gates.length > 1) hardF('H10', 'gates', `${gates.length} waypoints are gates; one at most.`);
  if (gates.length >= 1) {
    const g = gates[0]!;
    if (g < 2) hardF('H10', `waypoint ${g + 1}`, 'Fewer than two walkable waypoints come before the gate.');
    const gAt = map[g]!.at;
    if (gAt)
      map.slice(g + 1).forEach((w, k) => {
        if (w.at && w.at < gAt) hardF('H10', `waypoint ${g + k + 2}`, `${wp(g + k + 1, w)} is dated before the gate it follows.`);
      });
  }

  // H11: one venue, one waypoint; three places on a map of four or more.
  const returning = /\b(again|back|still)\b/i.test(ctx.wishText);
  const venues = map.map((w) => venueOf(w.where.place));
  const placeOf = (v: string) => {
    for (const [canon, variants] of Object.entries(ledger.aka)) if (samePlace(v, canon) || variants.some((x) => samePlace(v, x))) return canon;
    return v;
  };
  if (!returning)
    for (let a = 0; a < venues.length; a++)
      for (let b = a + 1; b < venues.length; b++)
        if (samePlace(placeOf(venues[a]!), placeOf(venues[b]!)))
          hardF('H11', `waypoints ${a + 1},${b + 1}`, `${wp(a, map[a]!)} and ${wp(b, map[b]!)} are the same venue.`);
  if (map.length >= 4) {
    const distinct: string[] = [];
    for (const v of venues.map(placeOf)) if (!distinct.some((d) => samePlace(d, v))) distinct.push(v);
    if (distinct.length < 3) hardF('H11', 'map', 'Fewer than three different places on the map.');
  }

  // H12: a door first, a summit last.
  const first = map[0];
  const last = map.at(-1);
  if (first) {
    if (first.kind !== 'door') hardF('H12', 'waypoint 1', 'The first waypoint must be a door.');
    const today = dayNumber(ctx.todayIso);
    let soon = FIRST_WHEN.test(first.when);
    if (first.at && /^\d{4}-\d{2}-\d{2}$/.test(first.at)) soon = dayNumber(first.at) - today <= 14 && dayNumber(first.at) >= today - 1;
    else if (first.at && /^\d{4}-\d{2}$/.test(first.at)) soon = soon || dayNumber(`${first.at}-01`) - today <= 14;
    if (!soon) hardF('H12', 'waypoint 1', 'The first door must be within 14 days ("this week", a weekday, or a date).');
  }
  if (last && map.length >= 2) {
    if (last.kind !== 'summit') hardF('H12', `waypoint ${map.length}`, 'The last waypoint must be the summit.');
    if (!last.earns?.trim()) hardF('H12', `waypoint ${map.length}`, 'The summit earns nothing; it must pay off the calling.');
  }

  // H13: this week names a real channel.
  {
    const t = draft.thisWeek.text;
    const channel =
      ledgerNames.some((n) => mentions(t, n)) ||
      /[\w.+-]+@[\w-]+\.[\w.]+/.test(t) ||
      /\+?\d[\d\s-]{6,}\d/.test(t) ||
      [...t.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)].some((m) => hostSeen(m[1]!));
    if (!channel) hardF('H13', 'this week', 'This week names no channel from the ledger (a place, email, phone or site).');
    if (findPhrase(t, ['research'])) hardF('H13', 'this week', 'This week must be a deed, never "research".');
  }

  // H14: clues are signs, not logistics, and rest on what was seen.
  map.forEach((w, i) => {
    if (CLUE_LOGISTICS.test(w.clue)) hardF('H14', `waypoint ${i + 1} clue`, `${wp(i, w)}: the clue speaks of logistics.`);
    else if (!w.lore && !w.noteIds.some((id) => notes.get(id)?.status === 'verified'))
      hardF('H14', `waypoint ${i + 1} clue`, `${wp(i, w)}: the clue rests on no VERIFIED note (or set lore for the one legend clue).`);
  });

  // H15: a road abroad carries coin and papers.
  if (map.some((w) => !sameCountry(w.where.country, ctx.homeCountry))) {
    if (draft.provisions.coin.length === 0) hardF('H15', 'coin', 'A road abroad with no coin lines.');
    if (draft.provisions.papers.length === 0) hardF('H15', 'papers', 'A road abroad with no papers lines.');
  }

  // H16: past the obvious.
  {
    const matches = draft.forge.versusObvious.filter((v) => v.matches);
    if (matches.length > 1) hardF('H16', 'forge', 'More than one waypoint matches an obvious answer.');
    for (const v of matches)
      if (!v.edge) hardF('H16', 'forge', `Waypoint ${Math.round(v.position) + 1} matches an obvious answer with no hard edge.`);
  }

  // ---- Safety ------------------------------------------------------------

  const summit = map.length - 1;
  const testBefore = map.some((w, i) => w.kind === 'test' && i < summit);
  const spanYearsNow = { days: 1 / 365, weeks: 7 / 365, months: 1 / 12, years: 1 }[draft.span.unit] * draft.span.amount;
  if (tags.has('lethal')) {
    if (spanYearsNow < 2) safeF('X1', 'span', 'A lethal feat needs a ladder of at least two years.');
    if (!testBefore) safeF('X1', 'map', 'A lethal feat needs a test waypoint before the summit.');
    if (!draft.rule) safeF('X1', 'rule', 'A lethal feat needs its one survival rule.');
  } else if (tags.has('dangerous')) {
    if (!testBefore) safeF('X2', 'map', 'A dangerous road needs a test waypoint before the summit that meets the real conditions.');
    if (!draft.rule) safeF('X2', 'rule', 'A dangerous road needs its one survival rule.');
  }

  // X3: no waypoint inside a region the home government advises against.
  const zones = ledger.notes
    .filter((n) => (n.kind === 'advice' || n.kind === 'safety') && ALL_TRAVEL.test(n.text))
    .map((n) => {
      const parts = (n.place ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const region = n.name && !parts.some((p) => samePlace(p, n.name!)) ? n.name : (parts[0] ?? n.name);
      const country = parts.at(-1) ?? null;
      return { region, country };
    })
    .filter((z): z is { region: string; country: string | null } => !!z.region && (!z.country || !samePlace(z.region, z.country)));
  map.forEach((w, i) => {
    const text = `${w.where.place}, ${w.where.town ?? ''}, ${w.where.geoQuery}`;
    const zone = zones.find((z) => mentions(text, z.region));
    if (zone) safeF('X3', `waypoint ${i + 1} where`, `${wp(i, w)} lies in ${zone.region}, where the home government advises against all travel.`);
  });

  // X4: youth.
  if (tags.has('youth')) {
    map.forEach((w, i) => {
      const text = `${w.name} ${w.trial} ${w.where.place}`;
      const high = numbersIn(`${w.trial} ${w.clue}`).some((n) => n.value >= 4000 && /\d\s?m\b|metres|meters/i.test(w.trial + w.clue));
      if (w.kind === 'test' && ((COMBAT.test(text) && !YOUTH_SAFE.test(text)) || high || OPEN_OCEAN.test(text)))
        safeF('X4', `waypoint ${i + 1}`, `${wp(i, w)}: this test is not for a 13 to 17-year-old.`);
      const abroad = !sameCountry(w.where.country, ctx.homeCountry);
      w.road.forEach((s, j) => {
        if (abroad && SOLO.test(s.text)) safeF('X4', `waypoint ${i + 1} step ${j + 1}`, `${wp(i, w)}: no solo travel abroad before 18.`);
      });
      if (abroad && SOLO.test(w.trial)) safeF('X4', `waypoint ${i + 1} trial`, `${wp(i, w)}: no solo travel abroad before 18.`);
    });
  }

  // X5: inward wishes never reach for the other person.
  if (tags.has('inward')) {
    const targets = otherPeople(ctx.wishText, ledgerNames);
    map.forEach((w, i) => {
      for (const text of [w.trial, ...w.road.map((s) => s.text)]) {
        const hit = targets.find((t) => mentions(text, t) || norm(text).includes(norm(t)));
        if (hit) safeF('X5', `waypoint ${i + 1}`, `${wp(i, w)} reaches for the person the wish is about. The road is the Lorer's alone.`);
      }
    });
  }

  // X6: never pester a person or camp beside them.
  map.forEach((w, i) => {
    for (const [field, text] of [['trial', w.trial], ...w.road.map((s, j) => [`step ${j + 1}`, s.text] as const)] as const) {
      if (PESTER.test(text) && (personNotes.some((n) => mentions(text, n.name)) || (w.person?.name && mentions(text, w.person.name)) || /\b(him|her|them)\b/i.test(text)))
        safeF('X6', `waypoint ${i + 1} ${field}`, `${wp(i, w)}: ask a person once, through a public channel; never again and again, never camp beside them.`);
    }
  });

  return { draft, soft, hard, safety };
}

function hintPerson(personNotes: { id: string; name: string | null }[]): string {
  const p = personNotes[0];
  return p ? ` ${p.id} names ${p.name}.` : '';
}

/**
 * The other person an inward wish is about: proper names in the wish (not the Lorer's "I", not a
 * ledger name) and the pronoun the wish aims at ("make her love me" → "her love").
 */
export function otherPeople(wish: string, ledgerNames: readonly string[]): string[] {
  const out = new Set<string>();
  const words = wish.replace(/[’']/g, "'").split(/\s+/);
  words.forEach((w, i) => {
    const clean = w.replace(/[^\p{L}'-]/gu, '');
    if (i > 0 && /^\p{Lu}\p{Ll}{2,}$/u.test(clean) && clean !== 'I' && !ledgerNames.some((n) => mentions(n, clean))) out.add(clean);
  });
  for (const m of wish.matchAll(/\b(make|get|win|have|let) (him|her|them) (\w+)/gi)) out.add(`${m[2]} ${m[3]}`);
  for (const m of wish.matchAll(/\bmy (ex|crush|boyfriend|girlfriend|husband|wife|partner|boss)\b/gi)) out.add(`my ${m[1]}`);
  return [...out];
}

/** The marks this draft's lines rest on, for tests and the eval (the mind computes marks in draw.ts). */
export const markFor = (ids: string[], ledger: Ledger) => markOf(ids, ledger.notes);

/** Fault lines for the repair turn. */
export const faultLines = (faults: readonly Fault[]) => faults.map((f) => f.detail);
/** Fault codes for the log (no text). */
export const faultCodes = (faults: readonly Fault[]) => faults.map((f) => `${f.code} ${f.at}`);
