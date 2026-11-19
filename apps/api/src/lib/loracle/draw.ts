// Draw: code that turns a checked draft into the road the job stores, and the map's pins and seals.
//
// - toRoad: marks for every step, line, keeper and this-week deed (weakest note wins); sources cut
//   down to those the scroll cites and renumbered 1…n; coordinates only where a VERIFIED note the
//   waypoint cites gave them (precision `ledger`), or the mind's rough point for open water (`sea`).
// - drawPins: the job's pin pass after the text is `ready`. First hit wins: ledger → the place →
//   its town and country → its country → the open-water point. Never throws.
// - waypointState / shapeWaypoint: sealing, enforced on the server. A sealed waypoint is sent
//   without trial, keeper, earns, steps, ink or links.
import {
  LORACLE_OPEN_WAYPOINTS,
  type GeocodeResult,
  type Keeper,
  type Mark,
  type OpenWaypoint,
  type PinPrecision,
  type ProvisionLine,
  type Provisions,
  type QuestSource,
  type RoadStep,
  type SealedWaypoint,
  type Waypoint,
  type WaypointBase,
  type WaypointState,
} from '#shared';
import { foldName, markOf, samePlace, type Ledger } from './ledger.ts';
import type { DeeperDraftT, QuestDraftT, WaypointDraftT } from './schema.ts';
import type { DraftRoad, DraftWaypoint, DraftWhere, LedgerNote, StoredDeeper } from './types.ts';

const OPEN_WATER = /\b(ocean|sea|strait|channel|gulf|passage|bight|open water|at sea|mid-?atlantic|offshore)\b/i;
/** How close (degrees) the mind's point must be to a note's point to count as that point. */
const NEAR_DEG = 0.1;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The deed's day: a date within the next 7 days (a weekday name becomes its next date), else null. */
export function weekDay(day: string | null, todayIso: string): string | null {
  if (!day) return null;
  const today = utcDay(todayIso);
  const d = day.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const t = utcDay(d);
    return Number.isFinite(t) && t >= today && t - today <= 7 * DAY_MS ? d : null;
  }
  const w = WEEKDAYS.indexOf(d.toLowerCase().replace(/[^a-z]/g, ''));
  if (w < 0) return null;
  const now = new Date(today).getUTCDay();
  return isoOf(today + ((w - now + 7) % 7) * DAY_MS);
}

function whereOf(w: WaypointDraftT, notes: Map<string, LedgerNote>, ledger: Ledger): DraftWhere {
  const base = {
    place: w.where.place.trim(),
    town: w.where.town?.trim() || null,
    country: w.where.country.trim(),
    geoQuery: w.where.geoQuery.trim() || [w.where.place, w.where.town, w.where.country].filter(Boolean).join(', '),
  };
  const cited = w.noteIds
    .map((id) => ({ id, note: notes.get(id), at: ledger.coords[id] }))
    .filter((c): c is { id: string; note: LedgerNote; at: { lat: number; lon: number } } => !!c.note && !!c.at && c.note.status === 'verified');
  const { lat, lon } = w.where;
  if (lat !== null && lon !== null) {
    const near = cited.find((c) => Math.abs(c.at.lat - lat) <= NEAR_DEG && Math.abs(c.at.lon - lon) <= NEAR_DEG);
    if (near) return { ...base, lat: near.at.lat, lon: near.at.lon, precision: 'ledger' };
  }
  // A cited, verified note about this very place gave its point.
  const venue = base.place.split(',')[0]!.trim();
  const own = cited.find((c) => (c.note.name && samePlace(c.note.name, venue)) || (c.note.place && samePlace(c.note.place.split(',')[0]!, venue)));
  if (own) return { ...base, lat: own.at.lat, lon: own.at.lon, precision: 'ledger' };
  if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !base.town && OPEN_WATER.test(`${base.place} ${base.country} ${base.geoQuery}`))
    return { ...base, lat, lon, precision: 'sea' };
  return { ...base, lat: null, lon: null, precision: null };
}

/** Turn a checked draft into the stored road. Marks are computed from the ledger's notes. */
export function toRoad(draft: QuestDraftT, ledger: Ledger, todayIso: string): DraftRoad {
  const notes = new Map(ledger.notes.map((n) => [n.id, n]));
  const mark = (ids: readonly string[]) => markOf(ids, ledger.notes);

  const waypoints: DraftWaypoint[] = draft.map.map((w) => {
    const person: Keeper | null = w.person
      ? {
          name: w.person.name?.trim() || null,
          role: w.person.role.trim(),
          verb: w.person.verb.trim(),
          mark: w.person.noteId ? mark([w.person.noteId]) : null,
        }
      : null;
    const steps: RoadStep[] = w.road.map((s) => ({ kind: s.kind, text: s.text.trim(), mark: mark(s.noteIds) }));
    return {
      kind: w.kind,
      emblem: w.emblem,
      name: w.name.trim(),
      when: w.when.trim(),
      at: /^\d{4}-\d{2}(-\d{2})?$/.test(w.at ?? '') ? w.at : null,
      where: whereOf(w, notes, ledger),
      clue: w.clue.trim(),
      lore: w.lore,
      trial: w.trial.trim(),
      person,
      earns: w.earns?.trim() || null,
      mystery: w.mystery?.trim() || null,
      steps,
      noteIds: [...w.noteIds],
    };
  });

  const lines = (group: QuestDraftT['provisions']['coin']): ProvisionLine[] =>
    group.map((l) => ({ text: l.text.trim(), mark: l.counsel ? null : mark(l.noteIds), counsel: l.counsel }));
  const provisions: Provisions = {
    coin: lines(draft.provisions.coin),
    papers: lines(draft.provisions.papers),
    body: lines(draft.provisions.body),
    skills: lines(draft.provisions.skills),
    tongue: lines(draft.provisions.tongue),
  };

  const road: DraftRoad = {
    title: draft.title.trim(),
    calling: draft.calling.trim(),
    truth: draft.truth?.trim() || null,
    span: { amount: Math.max(1, Math.round(draft.span.amount)), unit: draft.span.unit },
    thisWeek: {
      text: draft.thisWeek.text.trim(),
      mark: mark(draft.thisWeek.noteIds),
      day: weekDay(draft.thisWeek.day, todayIso),
      minutes: Math.min(60, Math.max(5, Math.round(draft.thisWeek.minutes))),
    },
    provisions,
    rule: draft.rule?.trim() || null,
    sources: [],
    waypoints,
  };
  return compactSources(road, ledger.sources);
}

/** Keep only the sources the scroll's marks cite, renumbered 1…n in ledger order. */
export function compactSources(road: DraftRoad, all: readonly QuestSource[]): DraftRoad {
  const marks: Mark[] = [];
  const add = (m: Mark | null) => m && marks.push(m);
  add(road.thisWeek.mark);
  for (const w of road.waypoints) {
    add(w.person?.mark ?? null);
    w.steps.forEach((s) => add(s.mark));
  }
  for (const g of Object.values(road.provisions)) g.forEach((l) => add(l.mark));
  const used = new Set(marks.flatMap((m) => m.sources));
  const kept = all.filter((s) => used.has(s.n));
  const renumber = new Map(kept.map((s, i) => [s.n, i + 1]));
  for (const m of marks) m.sources = [...new Set(m.sources.map((n) => renumber.get(n)).filter((n): n is number => !!n))].sort((a, b) => a - b);
  road.sources = kept.map((s) => ({ ...s, n: renumber.get(s.n)! }));
  return road;
}

/**
 * A checked deeper answer as it is kept (phase B): marks from the ledger's notes (the deeper scout's
 * included), and only the sources those marks cite, renumbered 1…n for this answer alone.
 */
export function toDeeper(draft: DeeperDraftT, ledger: Ledger): StoredDeeper {
  const mark = (ids: readonly string[]) => markOf(ids, ledger.notes);
  const steps: RoadStep[] = draft.steps.map((s) => ({ kind: s.kind, text: s.text.trim(), mark: mark(s.noteIds) }));
  const keeper: Keeper | null = draft.keeper
    ? {
        name: draft.keeper.name?.trim() || null,
        role: draft.keeper.role.trim(),
        verb: draft.keeper.verb.trim(),
        mark: draft.keeper.noteId ? mark([draft.keeper.noteId]) : null,
      }
    : null;
  const marks = [...steps.map((s) => s.mark), keeper?.mark ?? null].filter((m): m is Mark => !!m);
  const used = new Set(marks.flatMap((m) => m.sources));
  const kept = ledger.sources.filter((s) => used.has(s.n));
  const renumber = new Map(kept.map((s, i) => [s.n, i + 1]));
  for (const m of marks) m.sources = [...new Set(m.sources.map((n) => renumber.get(n)).filter((n): n is number => !!n))].sort((a, b) => a - b);
  return {
    answer: {
      answer: draft.answer?.trim() || null,
      clue: draft.clue.trim(),
      steps,
      keeper,
      words: draft.words?.trim() || null,
      unknown: draft.unknown.trim(),
    },
    sources: kept.map((s) => ({ ...s, n: renumber.get(s.n)! })),
  };
}

// ---------------------------------------------------------------------------
// Pins (run by the job after the text is ready)

export type Geocode = (query: string) => Promise<GeocodeResult[]>;
export interface Pin {
  lat: number;
  lon: number;
  precision: PinPrecision;
}

/**
 * A pin for each waypoint, in order; null when nothing could place it. Geocoder failures fall
 * through to the next level. Queries are asked once each (world.ts caches and paces Nominatim).
 */
export async function drawPins(
  waypoints: readonly { where: DraftWhere }[],
  geocode: Geocode,
  signal?: AbortSignal,
): Promise<(Pin | null)[]> {
  const asked = new Map<string, Promise<GeocodeResult | null>>();
  const ask = (q: string) => {
    const key = q.trim().toLowerCase();
    if (!key || key === '-') return Promise.resolve(null);
    let p = asked.get(key);
    if (!p) {
      p = geocode(q.trim()).then(
        (r) => r[0] ?? null,
        () => null,
      );
      asked.set(key, p);
    }
    return p;
  };
  const pins: (Pin | null)[] = [];
  for (const { where } of waypoints) {
    signal?.throwIfAborted();
    if (where.precision === 'ledger' && where.lat !== null && where.lon !== null) {
      pins.push({ lat: where.lat, lon: where.lon, precision: 'ledger' });
      continue;
    }
    const tries: [string | null, PinPrecision][] = [
      [where.geoQuery || null, 'place'],
      [where.town ? `${where.town}, ${where.country}` : null, 'town'],
      [where.country, 'country'],
    ];
    let pin: Pin | null = null;
    for (const [q, precision] of tries) {
      if (!q) continue;
      const hit = await ask(q);
      if (hit) {
        pin = { lat: hit.lat, lon: hit.lon, precision };
        break;
      }
    }
    if (!pin && where.precision === 'sea' && where.lat !== null && where.lon !== null)
      pin = { lat: where.lat, lon: where.lon, precision: 'sea' };
    pins.push(pin);
  }
  return pins;
}

// ---------------------------------------------------------------------------
// Seals

/**
 * open: the first LORACLE_OPEN_WAYPOINTS, or the one after an inked waypoint, or one whose seal the
 * Lorer broke · inked: the Lorer did it · sealed: everything else.
 */
export function waypointState(position: number, inked: boolean, previousInked: boolean, sealBroken: boolean): WaypointState {
  if (inked) return 'inked';
  if (position < LORACLE_OPEN_WAYPOINTS || previousInked || sealBroken) return 'open';
  return 'sealed';
}

/** A waypoint as stored, before sealing (every field, as an open waypoint would show it; asks and walkers are added by the route). */
export type FullWaypoint = Omit<OpenWaypoint, 'state' | 'asks' | 'walkers' | 'walking'>;

/**
 * What the Lorer is sent. A sealed waypoint is built field by field from the base, so nothing
 * behind the wax (trial, keeper, earns, steps, ink, note, links) can leak.
 */
export function shapeWaypoint(full: FullWaypoint, state: WaypointState): Waypoint {
  const base: WaypointBase = {
    id: full.id,
    position: full.position,
    kind: full.kind,
    emblem: full.emblem,
    name: full.name,
    when: full.when,
    at: full.at,
    where: { ...full.where },
    clue: full.clue,
    lore: full.lore,
    mystery: full.mystery,
  };
  if (state === 'sealed') {
    const sealed: SealedWaypoint = { ...base, state: 'sealed' };
    return sealed;
  }
  return {
    ...base,
    state,
    trial: full.trial,
    person: full.person,
    earns: full.earns,
    steps: full.steps,
    inkedOn: full.inkedOn,
    note: full.note,
    links: full.links,
    asks: [],
    walkers: [],
    walking: false,
  };
}

/** Whether two waypoint places are one venue (for links and the log). */
export const sameVenue = (a: string, b: string) => samePlace(a.split(',')[0]!, b.split(',')[0]!) || foldName(a) === foldName(b);
