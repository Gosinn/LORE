// The Loracle: a Lorer tells the stones what they wish for, and the stones draw a road (a quest).
//
// A wish is private to the Lorer who cast it, unless they show it to one crew (phase C): then that
// crew's members may open it (lib/access.ts wishVisible; 404 for everyone else), without the Lorer's
// realm, notes, links, reminders or deeper asks, without what the stone drew from the Lorer's own
// answers (the road's signs, dawn promise, This week, provisions), without the map points while the
// Lorer hides their places (D35), and may walk its open waypoints with them. Every
// deed on a quest is the Lorer's alone (403 `not_yours` for a crew member). The weighing, the
// ledger, the forge, note ids and dossiers never leave the server; sealed waypoints are sent
// without their trial, keeper, earns, steps, ink and links.
//
// Phase B: "Ask again" draws another road from the same ledger (no scouts); "Ask the stone about
// this" lights one waypoint. Past the stone's soft budget for the Lorer's day (or everyone's), a
// cast, an Ask again or an ask is written down for dawn and read at half price by the hourly tick
// (lib/loracle/dawn.ts, POST /loracle/tick); never a refusal, never a number.
//
// A cast (POST /loracle/wishes) weighs the wish while the Lorer waits:
//   care    → the care screen (a checked crisis line for the realm's country); nothing stored
//   riddle  → one question back; nothing stored
//   reroute → the honest wish under it; nothing stored
//   silent  → the mind declined; nothing stored
//   quest   → the wish and its road are written and a background job draws it (lib/loracle/jobs.ts)
// Past the hidden per-Lorer limit the stone rests (answered in-world, never with a number); past
// the owner's monthly ceiling the wish is written and waits for the new moon, and far past it
// nothing is weighed until the new moon. Nothing else limits adventure (docs/DECISIONS.md D30).
//
// Care comes first and needs nothing: the care floor (lib/loracle/care.ts) answers before the mind,
// consent, realm or any limit is asked.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AskDeeperInput,
  CastWishInput,
  copy,
  CRISIS_LINES,
  EMERGENCY_NUMBERS,
  FIND_A_HELPLINE,
  InkWaypointInput,
  LinkWaypointInput,
  LORACLE_LINES,
  LoracleSettingsInput,
  NO_LIMIT_KM,
  PlanWaypointInput,
  PROVISION_GROUPS,
  ROAD_IN_PROGRESS,
  roadPhase,
  ShareWishInput,
  signLine,
  UpdateWishInput,
  WaypointNoteInput,
  WeekInput,
  type AskResult,
  type CareView,
  type CastResult,
  type CrewRef,
  type DeeperView,
  type EpicView,
  type EventCategory,
  type Keeper,
  type LoracleMindState,
  type LoracleSettings,
  type LoracleState,
  type LoracleTickResult,
  type Mark,
  type Provisions,
  type RoadStep,
  type UserSummary,
  type Waypoint,
  type WaypointKind,
  type WaypointState,
  type Wish,
  type WishScroll,
  type WishStatus,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import {
  chapters,
  crews,
  eventParticipants,
  events,
  ideas,
  notes,
  oracleSettings,
  users,
  wishAsks,
  wishes,
  wishRoads,
  wishWalkers,
  wishWaypoints,
} from '../db/schema.ts';
import {
  chapterVisible,
  eventParticipant,
  idParam,
  isActiveCrewMember,
  loadVisibleChapter,
  loadVisibleEvent,
  loadVisibleIdea,
  loadVisibleRoad,
  loadVisibleWaypoint,
  loadVisibleWish,
  placeAccessFor,
  walkerShown,
} from '../lib/access.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { careFloor } from '../lib/loracle/care.ts';
import { waypointState } from '../lib/loracle/draw.ts';
import {
  asksInLast24h,
  castsInLast24h,
  fadeUnsent,
  farPastTheMoon,
  fullContext,
  lateSpend,
  laneFor,
  localDay,
  mindContextFor,
  pastTheMoon,
  recordSpend,
  weighsInLast24h,
} from '../lib/loracle/jobs.ts';
import { addDays, nextDawn, zonedInstant } from '../lib/loracle/time.ts';
import { MindError, type LoracleMind, type MindContext, type MindWish, type SpendEntry, type WeighVerdict } from '../lib/loracle/types.ts';
import { notify } from '../lib/notify.ts';
import { crewQuestSummaries, iso, isoOrNull, userSummaries, wishSummaries } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';
import { distanceKm } from '../lib/world.ts';
import { inviteToEvent } from './events.ts';

export { zonedInstant } from '../lib/loracle/time.ts';

type WishRow = typeof wishes.$inferSelect;
type RoadRow = typeof wishRoads.$inferSelect;
type WaypointRow = typeof wishWaypoints.$inferSelect;
type SettingsRow = typeof oracleSettings.$inferSelect;

/** One weighing attempt may take this long before the fog wins (the mind aims for ~10 s). */
const WEIGH_TIMEOUT_MS = 25_000;
/** A weighing cut off by a closed connection or the timeout: how long to wait for what it cost. */
const WEIGH_LATE_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The same limit as a cast, for "Try again". */
const CAST_RATE = { max: 10, timeWindow: '1 minute' } as const;
/** A realm's label looked up by name counts only within this distance of the realm's own point. */
const REALM_NAME_KM = 100;

/** What /api/health and GET /loracle say about the stone's mind. */
export const mindState = (mind: LoracleMind | undefined): LoracleMindState =>
  !mind ? 'asleep' : mind.kind === 'fake' ? 'fake' : 'awake';

// ---------------------------------------------------------------------------
// Care (the floor itself lives in lib/loracle/care.ts)

/** The care screen for a country: its checked crisis line and emergency number, when the tables have them. */
export function careFor(country: string | null | undefined): CareView {
  const c = country?.toUpperCase() ?? '';
  const line = CRISIS_LINES[c];
  return {
    crisis: line ? { name: line.name, number: line.number, hours: line.hours, text: line.text } : null,
    emergency: EMERGENCY_NUMBERS[c] ?? null,
    more: FIND_A_HELPLINE,
  };
}

/**
 * The stone's seal on a reroute offer: only an offer the stone itself made to this Lorer today can be
 * cast as `rerouted` (which tells the weighing the wish came from the stone).
 */
const offerKey = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function offerToken(secret: string, userId: string, day: string, offer: string): string {
  return createHmac('sha256', secret).update(`loracle-offer\n${userId}\n${day}\n${offerKey(offer)}`).digest('base64url');
}
export function offerHonest(secret: string, userId: string, day: string, offer: string, token: string | undefined): boolean {
  if (!token) return false;
  const want = Buffer.from(offerToken(secret, userId, day, offer));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** sha256 of the wish without its "I wish (to)", case, punctuation and spacing: "the same wish". */
export function wishKey(text: string): string {
  const plain = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^i wish(?: to| that| i)?\s*/, '');
  return createHash('sha256').update(plain).digest('hex');
}

// ---------------------------------------------------------------------------
// Dates in the Lorer's zone (lib/loracle/time.ts)

/** A waypoint's `at` as a day: 'YYYY-MM-DD' as it is, 'YYYY-MM' as its first day. */
const dayFromAt = (at: string | null) =>
  at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : at && /^\d{4}-\d{2}$/.test(at) ? `${at}-01` : null;

/** What kind of plan a waypoint makes. */
const KIND_CATEGORY: Record<WaypointKind, EventCategory> = {
  door: 'custom',
  bridge: 'road_trip',
  crucible: 'sports',
  test: 'competition',
  gate: 'custom',
  pilgrimage: 'road_trip',
  summit: 'expedition',
  return: 'celebration',
};

const placeLine = (w: Pick<WaypointRow, 'place' | 'town' | 'country'>) =>
  [...new Set([w.place, w.town, w.country].filter((s): s is string => !!s?.trim()))].join(', ');

// ---------------------------------------------------------------------------
// Views: rows → the shapes in packages/shared/src/types.ts. Built field by field, so nothing the
// mind kept for itself (note ids, forge, weighing, ledger) can slip through.

const toMark = (m: Mark | null | undefined): Mark | null =>
  m ? { status: m.status, year: m.year ?? null, sources: [...(m.sources ?? [])] } : null;
const toStep = (s: RoadStep): RoadStep => ({ kind: s.kind, text: s.text, mark: toMark(s.mark) });
const toKeeper = (k: Keeper | null | undefined): Keeper | null =>
  k ? { name: k.name ?? null, role: k.role, verb: k.verb, mark: toMark(k.mark) } : null;
const toProvisions = (p: Partial<Provisions>): Provisions =>
  Object.fromEntries(
    PROVISION_GROUPS.map((g) => [g, (p[g] ?? []).map((l) => ({ text: l.text, mark: toMark(l.mark), counsel: !!l.counsel }))]),
  ) as Provisions;

/** Open, sealed or inked (the rule lives in lib/loracle/draw.ts: the first two open, then one at a time). */
const stateOf = (w: WaypointRow, previous: Pick<WaypointRow, 'inkedAt'> | undefined): WaypointState =>
  waypointState(w.position, !!w.inkedAt, !!previous?.inkedAt, !!w.sealBrokenAt);

type AskRow = typeof wishAsks.$inferSelect;

/** What the viewer adds to a waypoint: the Lorer's own asks, and the crew members who walk it. */
interface WaypointExtras {
  /** The viewer cast the wish (else: a crew member it was shown to). */
  mine: boolean;
  asks: DeeperView[];
  walkers: UserSummary[];
  walking: boolean;
  /**
   * The waypoint's map point goes out: always to the Lorer; to a crew member only while the Lorer's
   * "Show my places on maps" is on (D35: nobody else gets the point of anything you made). The
   * place, town and country names stay, as D35 keeps names.
   */
  point: boolean;
}

const NO_EXTRAS: WaypointExtras = { mine: true, asks: [], walkers: [], walking: false, point: true };

export function toDeeperView(a: AskRow): DeeperView {
  const stored = a.answer;
  return {
    id: a.id,
    question: a.question,
    status: a.status,
    lane: a.lane,
    dueBy: isoOrNull(a.dueBy),
    signs: a.signs,
    answer: stored
      ? {
          answer: stored.answer.answer ?? null,
          clue: stored.answer.clue,
          steps: (stored.answer.steps ?? []).map(toStep),
          keeper: toKeeper(stored.answer.keeper),
          words: stored.answer.words ?? null,
          unknown: stored.answer.unknown,
        }
      : null,
    sources: (stored?.sources ?? []).map((s) => ({ n: s.n, title: s.title, url: s.url, host: s.host, date: s.date ?? null, opened: !!s.opened })),
    createdAt: iso(a.createdAt),
  };
}

function toWaypoint(w: WaypointRow, state: WaypointState, extras: WaypointExtras = NO_EXTRAS): Waypoint {
  const { point } = extras;
  const base = {
    id: w.id,
    position: w.position,
    kind: w.kind,
    emblem: w.emblem,
    name: w.name,
    when: w.when,
    at: w.at,
    where: { place: w.place, town: w.town, country: w.country, lat: point ? w.lat : null, lon: point ? w.lon : null, precision: w.precision },
    clue: w.clue,
    lore: w.lore,
    mystery: w.mystery,
  };
  if (state === 'sealed') return { ...base, state };
  const { mine } = extras;
  return {
    ...base,
    state,
    trial: w.trial,
    person: toKeeper(w.person),
    earns: w.earns,
    steps: (w.steps ?? []).map(toStep),
    inkedOn: w.inkedOn,
    // The Lorer's own note, links and reminder stay theirs.
    note: mine ? w.note : null,
    links: mine
      ? { eventId: w.eventId, ideaId: w.ideaId, chapterId: w.chapterId, reminderId: w.reminderId }
      : { eventId: null, ideaId: null, chapterId: null, reminderId: null },
    asks: mine ? extras.asks : [],
    walkers: extras.walkers,
    walking: extras.walking,
  };
}

function toScroll(road: RoadRow, rows: WaypointRow[], extrasFor: (w: WaypointRow) => WaypointExtras = () => NO_EXTRAS, mine = true): WishScroll {
  const q = road.quest;
  const byPosition = new Map(rows.map((w) => [w.position, w]));
  const map = rows.map((w) => toWaypoint(w, stateOf(w, byPosition.get(w.position - 1)), extrasFor(w)));
  // A crew member reads the scroll as the stone drew it, without what was drawn from the Lorer's own
  // answers and life: the signs (the scouts' searches name their passport and home), the dawn
  // promise (their zone), This week (a door near home) and the provisions (coin, papers, body, tongue).
  return {
    id: road.id,
    n: road.n,
    status: road.status,
    lane: road.lane,
    dueBy: mine ? isoOrNull(road.dueBy) : null,
    phase: roadPhase(road.status),
    signs: mine ? road.signs : [],
    attempts: road.attempts,
    readyAt: isoOrNull(road.readyAt),
    title: q?.title ?? null,
    calling: q?.calling ?? null,
    truth: q?.truth ?? null,
    span: q?.span ? { amount: q.span.amount, unit: q.span.unit } : null,
    map,
    thisWeek: mine && q?.thisWeek
      ? {
          text: q.thisWeek.text,
          mark: toMark(q.thisWeek.mark),
          day: q.thisWeek.day ?? null,
          minutes: q.thisWeek.minutes,
          reminderId: road.thisWeekReminderId,
        }
      : null,
    provisions: mine && q?.provisions ? toProvisions(q.provisions) : null,
    rule: q?.rule ?? null,
    fog: map.filter((w) => w.mystery).map((w) => ({ position: w.position, text: w.mystery! })),
    sources: (q?.sources ?? []).map((s) => ({
      n: s.n,
      title: s.title,
      url: s.url,
      host: s.host,
      date: s.date ?? null,
      opened: !!s.opened,
    })),
  };
}

/** The road walked furthest (most waypoints inked; ties: the first). */
function walkedOf<T extends { road: RoadRow; rows: WaypointRow[] }>(roads: T[]): T | undefined {
  let best: T | undefined;
  for (const r of roads) {
    const inked = r.rows.filter((w) => w.inkedAt).length;
    if (!best || inked > best.rows.filter((w) => w.inkedAt).length) best = r;
  }
  return best;
}

function toWish(
  wish: WishRow,
  roads: { road: RoadRow; rows: WaypointRow[] }[],
  view: { mine: boolean; owner: UserSummary; crew: CrewRef | null; extrasFor: (w: WaypointRow) => WaypointExtras },
): Wish {
  const scrolls = roads.map((r) => toScroll(r.road, r.rows, view.extrasFor, view.mine));
  const walked = walkedOf(roads);
  return {
    id: wish.id,
    text: wish.text,
    status: wish.status,
    createdAt: iso(wish.createdAt),
    // Where the Lorer stands stays theirs.
    realm: view.mine ? wish.realm.label : '',
    beyond: (wish.weighing?.tags ?? []).includes('beyond'),
    road: scrolls[0]!,
    roads: scrolls,
    inked: walked ? walked.rows.filter((w) => w.inkedAt).length : 0,
    total: walked ? walked.rows.length : 0,
    mine: view.mine,
    owner: view.owner,
    audience: wish.audience,
    crew: view.crew,
  };
}

const toSettings = (row: SettingsRow | undefined): LoracleSettings => ({
  realm:
    row?.homeLabel && row.homeLat != null && row.homeLon != null
      ? { label: row.homeLabel, country: row.homeCountry ?? null, lat: row.homeLat, lon: row.homeLon }
      : null,
  // The Loracle's own reach; unset means ANYWHERE (the old Futures' radius is never used for quests).
  radiusKm: row?.loracleReachKm ?? NO_LIMIT_KM,
  timeZone: row?.timeZone ?? 'UTC',
  context: fullContext(row?.loracleContext),
});

// ---------------------------------------------------------------------------
// Answers in the stone's voice

const asleep = () => new HttpError(503, 'asleep', LORACLE_LINES.asleep);
const realmNeeded = () => new HttpError(400, 'realm', LORACLE_LINES.realmAsk, { home: LORACLE_LINES.realmHint });
const sealedError = () => new HttpError(409, 'sealed', LORACLE_LINES.sealed);
const stillWorking = () => new HttpError(409, 'in_progress', 'The stone is still at work on this one.');
const notReady = () => new HttpError(409, 'not_ready', 'The ink is not dry yet.');
const notYours = () => new HttpError(403, 'not_yours', LORACLE_LINES.notYours);
const consentNeeded = () => new HttpError(403, 'consent', LORACLE_LINES.consentTitle);

/** A unique index said no (23505), however deep the driver wrapped it. */
const uniqueViolation = (err: unknown) => {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === '23505') return true;
  }
  return false;
};

/** The bearer secret, compared in constant time (both sides hashed to one length first). */
export function tickAllowed(secret: string | undefined, header: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const want = createHash('sha256').update(secret).digest();
  const got = createHash('sha256').update(header.slice(7).trim()).digest();
  return timingSafeEqual(want, got);
}

export async function loracleRoutes(app: FastifyInstance, { db, world, config, mind }: AppContext) {
  const jobs = app.wishJobs;
  const dawn = app.dawn;

  // Weighings asked for per Lorer in this process (attempts, not completions): a weighing cut off by
  // a closed connection, or a care verdict (kept without a Lorer), still counts toward the cap.
  const weighAttempts = new Map<string, number[]>();
  let weighNotes = 0;
  const weighsHere = (me: string, now = Date.now()) => {
    const recent = (weighAttempts.get(me) ?? []).filter((t) => now - t < DAY_MS);
    if (recent.length) weighAttempts.set(me, recent);
    else weighAttempts.delete(me);
    return recent.length;
  };
  const noteWeigh = (me: string) => {
    const now = Date.now();
    weighAttempts.set(me, [...(weighAttempts.get(me) ?? []), now]);
    if (++weighNotes % 1000 === 0) for (const id of [...weighAttempts.keys()]) weighsHere(id, now);
  };

  // --- Settings ------------------------------------------------------------

  async function settingsRow(me: string): Promise<SettingsRow | undefined> {
    const [row] = await db.select().from(oracleSettings).where(eq(oracleSettings.userId, me)).limit(1);
    return row;
  }

  async function saveSettings(me: string, values: Partial<typeof oracleSettings.$inferInsert>) {
    await db
      .insert(oracleSettings)
      .values({ userId: me, ...values })
      .onConflictDoUpdate({ target: oracleSettings.userId, set: { ...values, updatedAt: new Date() } });
  }

  /**
   * "Where do you stand?": the realm's label and country. A realm set without a country (before
   * the Loracle, or from the device's location when no town was named) is looked up once: first the
   * town at the realm's own point, then its label by name, and its label becomes the town the
   * geocoder names (never a street: lib/world.ts gives town-level labels only). A name found far
   * from the realm's point is another place ("Near me" is not a town): the realm is never moved there.
   */
  async function realmOf(me: string, row: SettingsRow | undefined): Promise<{ label: string; country: string }> {
    if (!row?.homeLabel || row.homeLat == null || row.homeLon == null) throw realmNeeded();
    if (row.homeCountry) return { label: row.homeLabel, country: row.homeCountry };
    const { homeLat, homeLon } = row;
    const here = await world.reverse(homeLat, homeLon).catch(() => null);
    const found = here?.country
      ? [here]
      : (await world.geocode(row.homeLabel).catch(() => [])).filter((f) => distanceKm(homeLat, homeLon, f.lat, f.lon) <= REALM_NAME_KM);
    const nearest = found
      .filter((f) => f.country && /^[A-Za-z]{2}$/.test(f.country))
      .sort((a, b) => distanceKm(homeLat, homeLon, a.lat, a.lon) - distanceKm(homeLat, homeLon, b.lat, b.lon))[0];
    if (!nearest?.country) throw realmNeeded();
    const country = nearest.country.toUpperCase();
    await db.update(oracleSettings).set({ homeCountry: country, homeLabel: nearest.label }).where(eq(oracleSettings.userId, me));
    return { label: nearest.label, country };
  }

  // --- Loaders. Visibility lives in lib/access.ts (the Lorer's own, or shown to a crew they share;
  // 404 for anyone else); every deed is the Lorer's alone (403 for a crew member who can see it).

  async function loadOwnWish(me: string, id: string): Promise<WishRow> {
    const wish = await loadVisibleWish(db, me, id);
    if (wish.userId !== me) throw notYours();
    return wish;
  }

  async function roadsOf(wishId: string): Promise<RoadRow[]> {
    return db.select().from(wishRoads).where(eq(wishRoads.wishId, wishId)).orderBy(asc(wishRoads.n));
  }

  /** The wish as this viewer may see it: every road, the Lorer's asks (theirs only), the walkers. */
  async function wishView(me: string, wishId: string): Promise<Wish> {
    const wish = await loadVisibleWish(db, me, wishId);
    const mine = wish.userId === me;
    const roads = await roadsOf(wish.id);
    if (!roads.length) throw notFound('That wish');
    const rows = await db
      .select()
      .from(wishWaypoints)
      .where(eq(wishWaypoints.wishId, wish.id))
      .orderBy(asc(wishWaypoints.roadId), asc(wishWaypoints.position));
    const ids = rows.map((w) => w.id);
    // Deeper asks: the Lorer's alone, oldest first, at most 10 a waypoint.
    const askRows = mine && ids.length ? await db.select().from(wishAsks).where(inArray(wishAsks.waypointId, ids)).orderBy(asc(wishAsks.createdAt)) : [];
    const walkers = await walkersOf(wish, ids, me);
    const people = await userSummaries(db, [wish.userId, ...[...walkers.values()].flat()]);
    const crew = await crewOf(wish);
    const point = await pointShown(wish, me);
    const extrasFor = (w: WaypointRow): WaypointExtras => {
      const walking = walkers.get(w.id) ?? [];
      return {
        mine,
        point,
        asks: askRows.filter((a) => a.waypointId === w.id).slice(-10).map(toDeeperView),
        walkers: walking.map((id) => people.get(id)).filter((u): u is UserSummary => !!u),
        walking: walking.includes(me),
      };
    };
    return toWish(
      wish,
      roads.map((road) => ({ road, rows: rows.filter((w) => w.roadId === road.id) })),
      { mine, owner: people.get(wish.userId)!, crew, extrasFor },
    );
  }

  /** The crew a quest is shown to, while it is. */
  async function crewOf(wish: WishRow): Promise<CrewRef | null> {
    if (wish.audience !== 'crew' || !wish.crewId) return null;
    const [c] = await db.select({ id: crews.id, name: crews.name, emoji: crews.emoji }).from(crews).where(eq(crews.id, wish.crewId)).limit(1);
    return c ?? null;
  }

  /** Whether the viewer gets the quest's map points (lib/access.ts placeAccessFor: the Lorer's place switch, D35). */
  async function pointShown(wish: WishRow, me: string): Promise<boolean> {
    return wish.userId === me || (await placeAccessFor(db, wish.userId, me)) !== 'none';
  }

  /**
   * Who walks which waypoint (phase C): still in the crew it is shown to, and no block with the viewer
   * or the Lorer.
   */
  async function walkersOf(wish: WishRow, waypointIds: string[], viewer: string): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (wish.audience !== 'crew' || !wish.crewId || !waypointIds.length) return out;
    const rows = await db
      .select({ waypointId: wishWalkers.waypointId, userId: wishWalkers.userId })
      .from(wishWalkers)
      .where(and(inArray(wishWalkers.waypointId, waypointIds), walkerShown(wishWalkers.userId, sql`${wish.crewId}::uuid`, viewer, sql`${wish.userId}::uuid`)))
      .orderBy(asc(wishWalkers.createdAt));
    for (const r of rows) out.set(r.waypointId, [...(out.get(r.waypointId) ?? []), r.userId]);
    return out;
  }

  /** A waypoint the viewer can see, with its seal state. */
  async function loadSeenWaypoint(me: string, id: string) {
    const found = await loadVisibleWaypoint(db, me, id);
    const [previous] = await db
      .select({ inkedAt: wishWaypoints.inkedAt })
      .from(wishWaypoints)
      .where(and(eq(wishWaypoints.roadId, found.waypoint.roadId), eq(wishWaypoints.position, found.waypoint.position - 1)))
      .limit(1);
    return { ...found, state: stateOf(found.waypoint, previous) };
  }

  /** A waypoint of the Lorer's own wish. */
  async function loadOwnWaypoint(me: string, id: string) {
    const found = await loadSeenWaypoint(me, id);
    if (found.wish.userId !== me) throw notYours();
    return found;
  }

  /** A waypoint the Lorer may act on: sealed ones answer 409 until their seal is broken. */
  async function loadOpenWaypoint(me: string, params: unknown) {
    const found = await loadOwnWaypoint(me, idParam(params));
    if (found.state === 'sealed') throw sealedError();
    return found;
  }

  async function loadOwnRoad(me: string, id: string) {
    const found = await loadVisibleRoad(db, me, id);
    if (found.wish.userId !== me) throw notYours();
    return found;
  }

  /** The stone's per-Lorer rate (casts, retries, again, asks): only scripts ever meet it. */
  const userKey = (req: FastifyRequest) => req.userId ?? req.ip;

  /** Consent for anything that sends the Lorer's words to Anthropic. */
  async function requireConsent(me: string) {
    const settings = await settingsRow(me);
    if (!settings?.loracleConsentAt) throw consentNeeded();
    return settings;
  }

  // --- The weighing ----------------------------------------------------------

  /**
   * The mind's first look, while the Lorer waits. Follows the client (a closed connection stops
   * it); one retry inside the request, then the fog wins (503 `fog`). Paid requests are recorded.
   */
  async function weigh(
    reply: FastifyReply,
    wish: MindWish,
    ctx: MindContext,
    who: { userId: string; day: string },
  ): Promise<{ verdict: WeighVerdict; spend: SpendEntry[] }> {
    if (!mind) throw asleep();
    const client = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableFinished) client.abort();
    };
    reply.raw.once('close', onClose);
    const paid: SpendEntry[] = [];
    try {
      for (let attempt = 1; ; attempt++) {
        const signal = AbortSignal.any([client.signal, AbortSignal.timeout(WEIGH_TIMEOUT_MS)]);
        noteWeigh(who.userId);
        // Kept apart from the race: when the abort wins, this still says what was paid for.
        const weighP = mind.weigh(wish, ctx, signal);
        weighP.catch(() => undefined);
        try {
          const aborted = new Promise<never>((_, reject) => {
            const fail = () => reject(new MindError('timeout'));
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail, { once: true });
          });
          aborted.catch(() => undefined);
          const result = await Promise.race([weighP, aborted]);
          return { verdict: result.verdict, spend: [...paid, ...result.spend] };
        } catch (err) {
          let spent = err instanceof MindError ? err.spend : [];
          if (signal.aborted) spent = await lateSpend(weighP, spent, WEIGH_LATE_MS);
          paid.push(...spent);
          if (err instanceof MindError) {
            app.log.warn({ failure: err.failure, attempt, requestId: err.requestId }, 'loracle: weighing failed');
          } else {
            app.log.error({ err, attempt }, 'loracle: weighing crashed');
          }
          if (attempt >= 2 || client.signal.aborted) {
            await recordSpend(db, paid, { userId: who.userId, wishId: null, day: who.day });
            throw new HttpError(503, 'fog', LORACLE_LINES.fogWeigh);
          }
        }
      }
    } finally {
      reply.raw.off('close', onClose);
    }
  }

  // --- Routes ----------------------------------------------------------------

  /** The stone's face: its mind, the Lorer's answers to its questions and the quest log. */
  app.get('/loracle', async (req): Promise<LoracleState> => {
    const me = requireUser(req);
    jobs.sweepSoon();
    dawn.tickSoon();
    const row = await settingsRow(me);
    const [active, letGo, crewQuests] = await Promise.all([
      wishSummaries(db, me, { letGo: false, limit: 30 }),
      wishSummaries(db, me, { letGo: true, limit: 10 }),
      crewQuestSummaries(db, me, 30),
    ]);
    return {
      mind: mindState(mind),
      consented: !!row?.loracleConsentAt,
      settings: toSettings(row),
      wishes: active,
      letGo,
      crewQuests,
    };
  });

  /** The stone's questions: where you stand, how far you will go, what calls to you, what it should know. */
  app.put('/loracle/settings', async (req): Promise<LoracleSettings> => {
    const me = requireUser(req);
    const input = parse(LoracleSettingsInput, req.body);
    await saveSettings(me, {
      ...(input.home && {
        homeLabel: input.home.label,
        homeLat: input.home.lat,
        homeLon: input.home.lon,
        homeCountry: input.home.country ?? null,
        // By the app's clock, like the daily sign it is compared with (routes/oracle.ts todaysSign).
        homeSetAt: new Date(),
      }),
      // ANYWHERE is kept as null (the default), so "no limit" stays no limit.
      ...(input.radiusKm !== undefined && { loracleReachKm: input.radiusKm >= NO_LIMIT_KM ? null : input.radiusKm }),
      ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
      ...(input.context !== undefined && { loracleContext: input.context }),
    });
    return toSettings(await settingsRow(me));
  });

  /** "Let the stone read": the Lorer agrees to send wishes to Anthropic. Kept from the first time. */
  app.post('/loracle/consent', async (req): Promise<{ consented: boolean }> => {
    const me = requireUser(req);
    await db
      .insert(oracleSettings)
      .values({ userId: me, loracleConsentAt: new Date() })
      .onConflictDoUpdate({
        target: oracleSettings.userId,
        set: { loracleConsentAt: sql`coalesce(${oracleSettings.loracleConsentAt}, now())`, updatedAt: new Date() },
      });
    return { consented: true };
  });

  /**
   * "Stop sending wishes". Nothing more of this Lorer's goes to Anthropic: their running jobs stop,
   * and every road still waiting (queued, being drawn, or for the new moon) fades. Scrolls already
   * drawn stay; new casts and "Try again" need consent again.
   */
  app.delete('/loracle/consent', async (req): Promise<{ consented: boolean }> => {
    const me = requireUser(req);
    await db
      .update(oracleSettings)
      .set({ loracleConsentAt: null, updatedAt: new Date() })
      .where(eq(oracleSettings.userId, me));
    jobs.abortLorer(me);
    await fadeUnsent(db, me);
    return { consented: false };
  });

  /** Cast a wish. */
  app.post(
    '/loracle/wishes',
    { config: { rateLimit: { ...CAST_RATE, keyGenerator: (req) => req.userId ?? req.ip } } },
    async (req, reply): Promise<CastResult> => {
      const me = requireUser(req);
      const input = parse(CastWishInput, req.body);
      const row = await settingsRow(me);

      // Care comes first and needs nothing: no mind, no consent, no realm. Nothing is stored.
      if (careFloor(input.text) || (input.riddleAnswer && careFloor(input.riddleAnswer))) {
        return { route: 'care', care: careFor(row?.homeCountry) };
      }

      if (!mind) throw asleep();
      if (!row?.loracleConsentAt) throw new HttpError(403, 'consent', LORACLE_LINES.consentTitle);

      // The fold and the zone are remembered with every cast (privately; prefill and context only).
      if (input.context || input.timeZone) {
        await saveSettings(me, {
          ...(input.context && { loracleContext: input.context }),
          ...(input.timeZone && { timeZone: input.timeZone }),
        });
      }
      const context = input.context ?? fullContext(row.loracleContext);
      const timeZone = input.timeZone ?? row.timeZone;
      const realm = await realmOf(me, row);

      const now = new Date();
      const day = localDay(now, timeZone);
      const text = input.riddleAnswer ? `${input.text} — ${input.riddleAnswer}` : input.text;
      const textKey = wishKey(text);

      // The same wish today: the stone already drew this road.
      const [same] = await db
        .select({ id: wishes.id })
        .from(wishes)
        .where(and(eq(wishes.userId, me), eq(wishes.day, day), eq(wishes.textKey, textKey), ne(wishes.status, 'silent')))
        .orderBy(desc(wishes.createdAt))
        .limit(1);
      if (same) return { route: 'quest', wish: await wishView(me, same.id), existing: true };

      // The hidden limits: the stone rests. Never a number. Weighings are capped too (far above what
      // anyone casting by hand would reach), so riddles, silences and care can't be farmed on the
      // owner's money: attempts in this process count as well as the weighings recorded.
      if ((await castsInLast24h(db, me, now)) >= config.loracle.castsPer24h) return { route: 'rest' };
      const weighed = Math.max(await weighsInLast24h(db, me, now), weighsHere(me, now.getTime()));
      if (weighed >= config.loracle.weighsPer24h) return { route: 'rest' };
      // Far past the owner's ceiling, nothing is weighed until the new moon (nothing is stored).
      if (await farPastTheMoon(db, config.loracle)) return { route: 'moon' };

      // Only an offer the stone made to this Lorer today counts as taken up from the stone.
      const rerouted = !!input.rerouted && offerHonest(config.loracle.offerSecret, me, day, input.text, input.offerToken);
      const reachKm = row.loracleReachKm ?? NO_LIMIT_KM;
      const ctx = mindContextFor({
        realm,
        reachKm,
        context,
        timeZone,
        userId: me,
        anonSalt: config.loracle.anonSalt,
        now,
      });
      const { verdict, spend } = await weigh(
        reply,
        { text: input.text, riddleAnswer: input.riddleAnswer ?? null, rerouted },
        ctx,
        { userId: me, day },
      );

      switch (verdict.route) {
        case 'care':
          await recordSpend(db, spend, { userId: null, wishId: null, day: null });
          return { route: 'care', care: careFor(realm.country) };
        case 'riddle':
          await recordSpend(db, spend, { userId: me, wishId: null, day });
          return { route: 'riddle', riddle: { question: verdict.riddle.question, options: [...verdict.riddle.options] } };
        case 'reroute':
          await recordSpend(db, spend, { userId: me, wishId: null, day });
          return { route: 'reroute', offer: verdict.offer, offerToken: offerToken(config.loracle.offerSecret, me, day, verdict.offer) };
        case 'silent':
          await recordSpend(db, spend, { userId: me, wishId: null, day });
          return { route: 'silent' };
        case 'quest':
          break;
      }

      // Past the owner's ceiling the wish is written and waits for the new moon. Past the stone's
      // soft budget (phase B) it is written down for dawn and read at half price before 06:00.
      const moon = await pastTheMoon(db, config.loracle);
      const lane = moon ? 'now' : await laneFor(db, config.loracle, { kind: 'cast', userId: me, day, dawn: dawn.on, now });
      const { wishId, roadId } = await db.transaction(async (tx) => {
        const [wish] = await tx
          .insert(wishes)
          .values({
            userId: me,
            text,
            textKey,
            context,
            realm: { label: realm.label, country: realm.country, radiusKm: reachKm },
            timeZone,
            day,
            status: moon ? 'moon' : 'listening',
            weighing: verdict.weighing,
          })
          .returning({ id: wishes.id });
        const [road] = await tx
          .insert(wishRoads)
          .values({
            wishId: wish!.id,
            n: 1,
            status: 'queued',
            lane,
            day,
            dueBy: lane === 'dawn' ? nextDawn(now, timeZone) : null,
            signs: [signLine({ kind: 'listening' })],
          })
          .returning({ id: wishRoads.id });
        return { wishId: wish!.id, roadId: road!.id };
      });
      await recordSpend(db, spend, { userId: me, wishId, day });
      if (!moon && lane === 'now') jobs.start({ roadId, wishId, userId: me });
      reply.status(202);
      return { route: 'quest', wish: await wishView(me, wishId), existing: false };
    },
  );

  /** A wish and its scroll. Poll while the road is in progress or `ready`. */
  app.get('/loracle/wishes/:id', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const id = idParam(req.params);
    jobs.sweepSoon();
    return wishView(me, id);
  });

  /** The wish came true, let it go, or take it up again. */
  app.patch('/loracle/wishes/:id', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const wish = await loadOwnWish(me, idParam(req.params));
    const input = parse(UpdateWishInput, req.body);
    if (wish.status === 'listening' || wish.status === 'moon') throw stillWorking();
    const roads = await roadsOf(wish.id);
    const road = roads[0];
    if (!road) throw notFound('That wish');
    const drawn = roads.some((r) => r.quest);
    let set: { status: WishStatus; fulfilledAt?: Date | null; releasedAt?: Date | null };
    switch (input.status) {
      case 'fulfilled':
        if (!drawn) throw notReady();
        set = { status: 'fulfilled', fulfilledAt: wish.fulfilledAt ?? new Date(), releasedAt: null };
        break;
      case 'released':
        set = { status: 'released', releasedAt: new Date() };
        break;
      case 'revealed':
        set = { status: drawn ? 'revealed' : road.status === 'silent' ? 'silent' : 'faded', fulfilledAt: null, releasedAt: null };
        break;
    }
    await db
      .update(wishes)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(wishes.id, wish.id), eq(wishes.userId, me)));
    return wishView(me, wish.id);
  });

  /** Burn the scroll: its job stops first, then the wish, its road and waypoints are gone. */
  app.delete('/loracle/wishes/:id', async (req): Promise<{ ok: true }> => {
    const me = requireUser(req);
    const wish = await loadOwnWish(me, idParam(req.params));
    jobs.abort(wish.id);
    await db.delete(wishes).where(and(eq(wishes.id, wish.id), eq(wishes.userId, me)));
    return { ok: true };
  });

  /**
   * "Try again" on a faded road (the newest one: the cast's, or an "Ask again" road): once a day per
   * road, only while the Lorer lets the stone read and is under the hidden limit (the road itself
   * already counts toward it while its spend is recent). Always in the now lane: it is free.
   */
  app.post(
    '/loracle/wishes/:id/retry',
    { config: { rateLimit: { ...CAST_RATE, keyGenerator: userKey } } },
    async (req, reply): Promise<Wish> => {
      const me = requireUser(req);
      const wish = await loadOwnWish(me, idParam(req.params));
      if (!mind) throw asleep();
      await requireConsent(me);
      const road = (await roadsOf(wish.id)).filter((r) => r.status === 'faded').at(-1);
      if (!road) throw new HttpError(409, 'not_faded', 'The fog has not won this one.');
      const today = localDay(new Date(), wish.timeZone);
      if (road.retriedOn === today) throw new HttpError(409, 'retried', LORACLE_LINES.retried);
      if ((await castsInLast24h(db, me)) >= config.loracle.castsPer24h) throw new HttpError(409, 'rest', LORACLE_LINES.rest);
      const moon = await pastTheMoon(db, config.loracle);
      // Past the ceiling only the cast's own road waits for the new moon; another road waits to be asked again.
      if (moon && road.n > 1) throw new HttpError(409, 'moon', LORACLE_LINES.moonAsk);
      const retried = await db.transaction(async (tx) => {
        const rows = await tx
          .update(wishRoads)
          .set({
            status: 'queued',
            lane: 'now',
            dueBy: null,
            batch: null,
            attempts: 0,
            failure: null,
            runId: null,
            retriedOn: today,
            signs: sql`array_append(${wishRoads.signs}, ${signLine({ kind: 'listening' })})`,
            updatedAt: new Date(),
          })
          .where(and(eq(wishRoads.id, road.id), eq(wishRoads.status, 'faded')))
          .returning({ id: wishRoads.id });
        if (!rows.length) return false;
        if (road.n === 1)
          await tx
            .update(wishes)
            .set({ status: moon ? 'moon' : 'listening', releasedAt: null, updatedAt: new Date() })
            .where(eq(wishes.id, wish.id));
        return true;
      });
      if (retried && !moon) jobs.start({ roadId: road.id, wishId: wish.id, userId: me });
      reply.status(202);
      return wishView(me, wish.id);
    },
  );

  /**
   * "Ask again" (phase B): another road for the same wish, drawn from the ledger its first road found
   * (no scouts), different in shape and keepers. It counts as a cast; past the soft budget it waits
   * for dawn. Only once a road is drawn and none is still being drawn.
   */
  app.post(
    '/loracle/wishes/:id/again',
    { config: { rateLimit: { ...CAST_RATE, keyGenerator: userKey } } },
    async (req, reply): Promise<Wish> => {
      const me = requireUser(req);
      const wish = await loadOwnWish(me, idParam(req.params));
      if (!mind) throw asleep();
      await requireConsent(me);
      const roads = await roadsOf(wish.id);
      if (roads.some((r) => (ROAD_IN_PROGRESS as readonly string[]).includes(r.status) || r.status === 'ready') || wish.status === 'moon')
        throw stillWorking();
      if (!wish.ledger || !roads.some((r) => r.quest)) throw notReady();
      const now = new Date();
      if ((await castsInLast24h(db, me, now)) >= config.loracle.castsPer24h) throw new HttpError(409, 'rest', LORACLE_LINES.rest);
      if (await pastTheMoon(db, config.loracle)) throw new HttpError(409, 'moon', LORACLE_LINES.moonAsk);
      const day = localDay(now, wish.timeZone);
      const lane = await laneFor(db, config.loracle, { kind: 'cast', userId: me, day, dawn: dawn.on, now });
      const n = Math.max(...roads.map((r) => r.n)) + 1;
      let roadId: string;
      try {
        const [road] = await db
          .insert(wishRoads)
          .values({
            wishId: wish.id,
            n,
            status: 'queued',
            lane,
            day,
            dueBy: lane === 'dawn' ? nextDawn(now, wish.timeZone) : null,
            signs: [signLine({ kind: 'listening' })],
          })
          .returning({ id: wishRoads.id });
        roadId = road!.id;
      } catch {
        throw stillWorking(); // another "Ask again" for this wish won the race
      }
      if (lane === 'now') jobs.start({ roadId, wishId: wish.id, userId: me });
      reply.status(202);
      return wishView(me, wish.id);
    },
  );

  /** Break the seal: the waypoint shows everything, even before the one ahead of it is inked. */
  app.post('/loracle/waypoints/:id/unseal', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint, wish, state } = await loadOwnWaypoint(me, idParam(req.params));
    if (state === 'sealed') {
      await db.update(wishWaypoints).set({ sealBrokenAt: new Date() }).where(eq(wishWaypoints.id, waypoint.id));
    }
    return wishView(me, wish.id);
  });

  /** "I did this": ink the waypoint. When every waypoint is inked, the wish came true. */
  app.post('/loracle/waypoints/:id/ink', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint, wish } = await loadOpenWaypoint(me, req.params);
    const input = parse(InkWaypointInput, req.body ?? {});
    await db
      .update(wishWaypoints)
      .set({
        inkedAt: waypoint.inkedAt ?? new Date(),
        inkedOn: input.on ?? localDay(new Date(), wish.timeZone),
        ...(input.note !== undefined && { note: input.note }),
      })
      .where(eq(wishWaypoints.id, waypoint.id));
    const [left] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(wishWaypoints)
      .where(and(eq(wishWaypoints.roadId, waypoint.roadId), isNull(wishWaypoints.inkedAt)));
    if (!left?.n) {
      await db
        .update(wishes)
        .set({ status: 'fulfilled', fulfilledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(wishes.id, wish.id), eq(wishes.status, 'revealed')));
    }
    return wishView(me, wish.id);
  });

  /** Wipe the ink. The waypoint after it stays open: what was seen can't be unseen. */
  app.delete('/loracle/waypoints/:id/ink', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint, wish } = await loadOwnWaypoint(me, idParam(req.params));
    if (waypoint.inkedAt) {
      await db.transaction(async (tx) => {
        await tx.update(wishWaypoints).set({ inkedAt: null, inkedOn: null }).where(eq(wishWaypoints.id, waypoint.id));
        await tx
          .update(wishWaypoints)
          .set({ sealBrokenAt: new Date() })
          .where(
            and(
              eq(wishWaypoints.roadId, waypoint.roadId),
              eq(wishWaypoints.position, waypoint.position + 1),
              isNull(wishWaypoints.sealBrokenAt),
            ),
          );
      });
    }
    return wishView(me, wish.id);
  });

  /** The Lorer's own word on a waypoint. */
  app.patch('/loracle/waypoints/:id', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint, wish } = await loadOpenWaypoint(me, req.params);
    const input = parse(WaypointNoteInput, req.body);
    await db.update(wishWaypoints).set({ note: input.note }).where(eq(wishWaypoints.id, waypoint.id));
    return wishView(me, wish.id);
  });

  /**
   * Walkers (phase C) are invited to the waypoint's plan when the Lorer makes it (or makes it again):
   * crew members who still walk it, are still in the crew, and are not blocked either way. Only to a
   * plan the Lorer organizes and that is still open, and only people they may reach (routes/events.ts
   * inviteToEvent: friends or a shared crew, never across a block). A real invitation, so it is
   * notified like any other.
   */
  async function inviteWalkers(me: string, wish: WishRow, waypointId: string, eventId: string, title: string) {
    if (wish.audience !== 'crew' || !wish.crewId) return;
    const walking = await db
      .select({ userId: wishWalkers.userId })
      .from(wishWalkers)
      .where(
        and(
          eq(wishWalkers.waypointId, waypointId),
          walkerShown(wishWalkers.userId, sql`${wish.crewId}::uuid`, me, sql`${wish.userId}::uuid`),
        ),
      );
    const invited = await inviteToEvent(
      db,
      eventId,
      me,
      walking.map((w) => w.userId),
      { skipUnreachable: true },
    );
    if (!invited.length) return;
    const [actor] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, me)).limit(1);
    await notify(db, invited, {
      type: 'event_invite',
      actorId: me,
      title: copy('{actor} invited you to {title}', { actor: actor?.displayName ?? 'Someone', title }),
      href: `/events/${eventId}`,
    });
  }

  /** "Make it a plan": a private event with the Lorer as organizer, linked back to the waypoint. */
  app.post('/loracle/waypoints/:id/plan', async (req, reply): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint: w, wish } = await loadOpenWaypoint(me, req.params);
    const input = parse(PlanWaypointInput, req.body ?? {});
    if (w.eventId) {
      // Already a plan: walkers who joined since are invited now, only to a plan the Lorer organizes
      // that is still open (a waypoint may be linked to someone else's event: that stays theirs).
      const [event] = await db
        .select({ id: events.id, title: events.title, status: events.status })
        .from(events)
        .where(eq(events.id, w.eventId))
        .limit(1);
      const open = !!event && event.status !== 'completed' && event.status !== 'canceled';
      if (event && open && (await eventParticipant(db, event.id, me))?.role === 'organizer') await inviteWalkers(me, wish, w.id, event.id, event.title);
      return wishView(me, wish.id);
    }
    const [road] = await db.select({ quest: wishRoads.quest }).from(wishRoads).where(eq(wishRoads.id, w.roadId)).limit(1);
    const today = localDay(new Date(), wish.timeZone);
    const fromAt = dayFromAt(w.at);
    const day = input.day ?? (fromAt && fromAt >= today ? fromAt : addDays(today, 7));
    const eventId = await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          title: w.name.slice(0, 120),
          description: [w.trial, w.clue, road?.quest?.title ? `A waypoint on ${road.quest.title}, drawn by The Loracle.` : null]
            .filter(Boolean)
            .join('\n\n'),
          category: KIND_CATEGORY[w.kind] ?? 'custom',
          status: 'planning',
          startsAt: zonedInstant(day, '00:00', wish.timeZone),
          allDay: true,
          timeZone: wish.timeZone,
          locationName: placeLine(w).slice(0, 200) || null,
          lat: w.lat,
          lon: w.lon,
          audience: 'participants',
          createdBy: me,
        })
        .returning({ id: events.id });
      await tx.insert(eventParticipants).values({
        eventId: event!.id,
        userId: me,
        role: 'organizer',
        rsvp: 'going',
        respondedAt: new Date(),
      });
      await tx.update(wishWaypoints).set({ eventId: event!.id }).where(eq(wishWaypoints.id, w.id));
      return event!.id;
    });
    await inviteWalkers(me, wish, w.id, eventId, w.name.slice(0, 120));
    reply.status(201);
    return wishView(me, wish.id);
  });

  /** "Keep in the vault": a private (only me) idea, linked back to the waypoint. */
  app.post('/loracle/waypoints/:id/vault', async (req, reply): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint: w, wish } = await loadOpenWaypoint(me, req.params);
    if (w.ideaId) return wishView(me, wish.id);
    await db.transaction(async (tx) => {
      const [idea] = await tx
        .insert(ideas)
        .values({
          title: w.name.slice(0, 120),
          description: [w.clue, w.trial].filter(Boolean).join('\n\n'),
          category: KIND_CATEGORY[w.kind] ?? 'custom',
          status: 'dreaming',
          audience: 'only_me',
          whereNote: placeLine(w).slice(0, 200) || null,
          whenNote: w.when.slice(0, 200) || null,
          // The waypoint's pin, for the Lore Map (shared approximately by default, like any idea's).
          locationName: w.lat != null && w.lon != null ? placeLine(w).slice(0, 200) || null : null,
          lat: w.lat != null && w.lon != null ? w.lat : null,
          lon: w.lat != null && w.lon != null ? w.lon : null,
          createdBy: me,
        })
        .returning({ id: ideas.id });
      await tx.update(wishWaypoints).set({ ideaId: idea!.id }).where(eq(wishWaypoints.id, w.id));
    });
    reply.status(201);
    return wishView(me, wish.id);
  });

  /** A reminder note on `day` at `time` (18:00 by default) in the Lorer's zone, made or moved. */
  async function remind(me: string, existing: string | null, body: string, day: string, time: string, timeZone: string) {
    const remindAt = zonedInstant(day, time, timeZone);
    if (existing) {
      const moved = await db
        .update(notes)
        .set({ remindAt, doneAt: null, updatedAt: new Date() })
        .where(and(eq(notes.id, existing), eq(notes.userId, me)))
        .returning({ id: notes.id });
      if (moved.length) return existing;
    }
    const [note] = await db
      .insert(notes)
      .values({ userId: me, body: body.slice(0, 2000), remindAt })
      .returning({ id: notes.id });
    return note!.id;
  }

  /** "Put it in my week" for a waypoint's first step. */
  app.post('/loracle/waypoints/:id/week', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint: w, wish } = await loadOpenWaypoint(me, req.params);
    const input = parse(WeekInput, req.body);
    const body = `${w.name}: ${w.steps?.[0]?.text ?? w.trial}`;
    const reminderId = await remind(me, w.reminderId, body, input.day, input.time ?? '18:00', wish.timeZone);
    await db.update(wishWaypoints).set({ reminderId }).where(eq(wishWaypoints.id, w.id));
    return wishView(me, wish.id);
  });

  /** "Put it in my week" for the road's This week deed. */
  app.post('/loracle/roads/:id/week', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { road, wish } = await loadOwnRoad(me, idParam(req.params));
    const input = parse(WeekInput, req.body);
    if (!road.quest?.thisWeek) throw notReady();
    const body = road.quest.title ? `${road.quest.title}: ${road.quest.thisWeek.text}` : road.quest.thisWeek.text;
    const reminderId = await remind(me, road.thisWeekReminderId, body, input.day, input.time ?? '18:00', wish.timeZone);
    await db.update(wishRoads).set({ thisWeekReminderId: reminderId, updatedAt: new Date() }).where(eq(wishRoads.id, road.id));
    return wishView(me, wish.id);
  });

  /** Tie a waypoint to the plan, idea or chapter that came of it (null unlinks). Hidden targets are a 404. */
  app.put('/loracle/waypoints/:id/link', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint: w, wish } = await loadOpenWaypoint(me, req.params);
    const input = parse(LinkWaypointInput, req.body);
    if (input.eventId) await loadVisibleEvent(db, me, input.eventId);
    if (input.ideaId) await loadVisibleIdea(db, me, input.ideaId);
    if (input.chapterId) await loadVisibleChapter(db, me, input.chapterId);
    await db
      .update(wishWaypoints)
      .set({
        ...(input.eventId !== undefined && { eventId: input.eventId }),
        ...(input.ideaId !== undefined && { ideaId: input.ideaId }),
        ...(input.chapterId !== undefined && { chapterId: input.chapterId }),
      })
      .where(eq(wishWaypoints.id, w.id));
    return wishView(me, wish.id);
  });

  // --- Phase B: Ask the stone ---------------------------------------------------

  /**
   * "Ask the stone about this": a deeper ask on an open waypoint, with an optional question. The
   * stone answers in the background (poll the wish); past the soft budget the ask waits for dawn.
   * One ask at a time per waypoint. Only the Lorer who cast the wish asks, and only they see asks.
   */
  app.post(
    '/loracle/waypoints/:id/ask',
    { config: { rateLimit: { ...CAST_RATE, keyGenerator: userKey } } },
    async (req, reply): Promise<AskResult> => {
      const me = requireUser(req);
      const { waypoint: w, wish } = await loadOpenWaypoint(me, req.params);
      const input = parse(AskDeeperInput, req.body ?? {});
      // Care comes first, as for a cast: nothing is stored, nothing is sent (lib/loracle/care.ts).
      if (input.question && careFloor(input.question)) {
        const row = await settingsRow(me);
        return { route: 'care', care: careFor(row?.homeCountry ?? wish.realm.country) };
      }
      if (!mind) throw asleep();
      await requireConsent(me);
      if (!wish.ledger) throw notReady();
      const [busy] = await db
        .select({ id: wishAsks.id })
        .from(wishAsks)
        .where(and(eq(wishAsks.waypointId, w.id), inArray(wishAsks.status, ['listening', 'dawn'])))
        .limit(1);
      if (busy) throw new HttpError(409, 'in_progress', LORACLE_LINES.askBusy);
      const now = new Date();
      if ((await asksInLast24h(db, me, now)) >= config.loracle.asksPer24h) throw new HttpError(409, 'rest', LORACLE_LINES.rest);
      if (await pastTheMoon(db, config.loracle)) throw new HttpError(409, 'moon', LORACLE_LINES.moonAsk);
      const day = localDay(now, wish.timeZone);
      const lane = await laneFor(db, config.loracle, { kind: 'ask', userId: me, day, dawn: dawn.on, now });
      let ask: AskRow | undefined;
      try {
        [ask] = await db
          .insert(wishAsks)
          .values({
            waypointId: w.id,
            wishId: wish.id,
            userId: me,
            day,
            lane,
            dueBy: lane === 'dawn' ? nextDawn(now, wish.timeZone) : null,
            question: input.question,
            status: lane === 'dawn' ? 'dawn' : 'listening',
            signs: [signLine({ kind: 'listening' })],
          })
          .returning();
      } catch (err) {
        // wish_asks_one_open: another ask on this waypoint won the race (a double tap).
        if (uniqueViolation(err)) throw new HttpError(409, 'in_progress', LORACLE_LINES.askBusy);
        throw err;
      }
      if (lane === 'now') jobs.startAsk({ askId: ask!.id, wishId: wish.id, userId: me });
      reply.status(202);
      return toDeeperView(ask!);
    },
  );

  // --- Phase C: Show to a crew, Walk with you, the Epic -----------------------------

  /**
   * "Show to a crew" (or keep it to yourself again). One crew at a time, one the Lorer is an active
   * member of (404 otherwise). Only the Lorer who cast it. Changing the crew, or keeping it again,
   * lets go of everyone who walked with them.
   */
  app.put('/loracle/wishes/:id/share', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const wish = await loadOwnWish(me, idParam(req.params));
    const input = parse(ShareWishInput, req.body);
    const crewId = input.audience === 'crew' ? input.crewId : null;
    // Taken down after a report (D29): it stays the Lorer's alone.
    if (crewId && wish.sharingRemovedAt) throw new HttpError(409, 'removed', LORACLE_LINES.shareRemoved);
    if (crewId && !(await isActiveCrewMember(db, crewId, me))) throw notFound('That crew');
    const same = input.audience === wish.audience && crewId === wish.crewId;
    await db.transaction(async (tx) => {
      if (!same) {
        await tx
          .delete(wishWalkers)
          .where(inArray(wishWalkers.waypointId, tx.select({ id: wishWaypoints.id }).from(wishWaypoints).where(eq(wishWaypoints.wishId, wish.id))));
      }
      await tx
        .update(wishes)
        .set({
          audience: input.audience,
          crewId,
          sharedAt: crewId ? (same ? wish.sharedAt : new Date()) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(wishes.id, wish.id), eq(wishes.userId, me)));
    });
    return wishView(me, wish.id);
  });

  /**
   * "Walk with you": a crew member the quest was shown to walks one of its open waypoints with the
   * Lorer. When the Lorer makes that waypoint a plan, the walkers are invited to it. No notification
   * otherwise.
   */
  app.post('/loracle/waypoints/:id/walk', async (req, reply): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint: w, wish, state } = await loadSeenWaypoint(me, idParam(req.params));
    if (wish.userId === me) throw new HttpError(409, 'own', LORACLE_LINES.walkOwn);
    if (state === 'sealed') throw sealedError();
    if (state === 'inked') throw new HttpError(409, 'inked', LORACLE_LINES.walkDone);
    await db.insert(wishWalkers).values({ waypointId: w.id, userId: me }).onConflictDoNothing();
    reply.status(201);
    return wishView(me, wish.id);
  });

  /** Walk no more. */
  app.delete('/loracle/waypoints/:id/walk', async (req): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint: w, wish } = await loadSeenWaypoint(me, idParam(req.params));
    await db.delete(wishWalkers).where(and(eq(wishWalkers.waypointId, w.id), eq(wishWalkers.userId, me)));
    return wishView(me, wish.id);
  });

  /**
   * The Epic: a fulfilled quest as lore. The road walked furthest, each waypoint with the day it was
   * inked and its chapter (only one the viewer may see), and who walked it. For the Lorer and, when
   * it is shown to a crew, its members.
   */
  app.get('/loracle/wishes/:id/epic', async (req): Promise<EpicView> => {
    const me = requireUser(req);
    const wish = await loadVisibleWish(db, me, idParam(req.params));
    if (wish.status !== 'fulfilled') throw new HttpError(409, 'not_fulfilled', LORACLE_LINES.epicNotYet);
    const roads = await roadsOf(wish.id);
    const rows = await db.select().from(wishWaypoints).where(eq(wishWaypoints.wishId, wish.id)).orderBy(asc(wishWaypoints.position));
    const walked = walkedOf(roads.map((road) => ({ road, rows: rows.filter((w) => w.roadId === road.id) })));
    if (!walked) throw notFound('That wish');
    const map = walked.rows;
    const chapterIds = map.map((w) => w.chapterId).filter((id): id is string => !!id);
    const seenChapters = chapterIds.length
      ? await db
          .select({ id: chapters.id, title: chapters.title })
          .from(chapters)
          .where(and(inArray(chapters.id, chapterIds), chapterVisible(me)))
      : [];
    const byChapter = new Map(seenChapters.map((c) => [c.id, c]));
    const walkers = await walkersOf(wish, map.map((w) => w.id), me);
    const people = await userSummaries(db, [wish.userId, ...[...walkers.values()].flat()]);
    const point = await pointShown(wish, me);
    const q = walked.road.quest;
    return {
      id: wish.id,
      text: wish.text,
      title: q?.title ?? null,
      calling: q?.calling ?? null,
      truth: q?.truth ?? null,
      span: q?.span ? { amount: q.span.amount, unit: q.span.unit } : null,
      fulfilledAt: isoOrNull(wish.fulfilledAt),
      roadN: walked.road.n,
      map: map.map((w) => ({
        id: w.id,
        position: w.position,
        kind: w.kind,
        emblem: w.emblem,
        name: w.name,
        where: { place: w.place, town: w.town, country: w.country, lat: point ? w.lat : null, lon: point ? w.lon : null, precision: w.precision },
        inkedOn: w.inkedOn,
        chapter: w.chapterId ? (byChapter.get(w.chapterId) ?? null) : null,
        walkers: (walkers.get(w.id) ?? []).map((id) => people.get(id)).filter((u): u is UserSummary => !!u),
      })),
      mine: wish.userId === me,
      owner: people.get(wish.userId)!,
      crew: await crewOf(wish),
    };
  });

  // --- The dawn tick ----------------------------------------------------------------

  /**
   * The hourly dawn tick (GitHub Actions, .github/workflows/loracle-tick.yml): collect ended batches,
   * keep the promises due within three hours, send what waits. No Lorer: `Authorization: Bearer
   * LORACLE_TICK_SECRET`, compared in constant time. 404 when the secret is unset or doesn't match.
   */
  app.post('/loracle/tick', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req): Promise<LoracleTickResult> => {
    if (!tickAllowed(config.loracle.tickSecret, req.headers.authorization)) throw notFound();
    return dawn.tick();
  });
}
