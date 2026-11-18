// The Loracle: a Lorer tells the stones what they wish for, and the stones draw a road (a quest).
//
// Everything here is private to the Lorer who cast it: every wish, road and waypoint is loaded
// through an owner check that answers 404 for anyone else (there is no sharing in phase A).
// The weighing, the ledger, the forge, note ids and dossiers never leave the server; sealed
// waypoints are sent without their trial, keeper, earns, steps, ink and links.
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
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CastWishInput,
  CRISIS_LINES,
  EMERGENCY_NUMBERS,
  FIND_A_HELPLINE,
  InkWaypointInput,
  isoWeek,
  LinkWaypointInput,
  LORACLE_LINES,
  LoracleSettingsInput,
  loracleExamples,
  NO_LIMIT_KM,
  PlanWaypointInput,
  PROVISION_GROUPS,
  roadPhase,
  signLine,
  UpdateWishInput,
  WaypointNoteInput,
  WeekInput,
  type CareView,
  type CastResult,
  type EventCategory,
  type Keeper,
  type LoracleMindState,
  type LoracleSettings,
  type LoracleState,
  type Mark,
  type Provisions,
  type RoadStep,
  type Waypoint,
  type WaypointKind,
  type WaypointState,
  type Wish,
  type WishScroll,
  type WishStatus,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { eventParticipants, events, ideas, notes, oracleSettings, wishes, wishRoads, wishWaypoints } from '../db/schema.ts';
import {
  idParam,
  loadVisibleChapter,
  loadVisibleEvent,
  loadVisibleIdea,
  loadVisibleRoad,
  loadVisibleWaypoint,
  loadVisibleWish,
} from '../lib/access.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { careFloor } from '../lib/loracle/care.ts';
import { waypointState } from '../lib/loracle/draw.ts';
import {
  castsInLast24h,
  fadeUnsent,
  farPastTheMoon,
  fullContext,
  lateSpend,
  localDay,
  mindContextFor,
  pastTheMoon,
  recordSpend,
  weighsInLast24h,
} from '../lib/loracle/jobs.ts';
import { MindError, type LoracleMind, type MindContext, type MindWish, type SpendEntry, type WeighVerdict } from '../lib/loracle/types.ts';
import { iso, isoOrNull, wishSummaries } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';
import { distanceKm } from '../lib/world.ts';

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
// Dates in the Lorer's zone

const tzOffsetMs = (at: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
};

/** The instant of a wall-clock time on a day in a zone ("2026-11-21", "18:00", "Atlantic/Reykjavik"). */
export function zonedInstant(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const first = wall - tzOffsetMs(new Date(wall), timeZone);
  const second = wall - tzOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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

function toWaypoint(w: WaypointRow, state: WaypointState): Waypoint {
  const base = {
    id: w.id,
    position: w.position,
    kind: w.kind,
    emblem: w.emblem,
    name: w.name,
    when: w.when,
    at: w.at,
    where: { place: w.place, town: w.town, country: w.country, lat: w.lat, lon: w.lon, precision: w.precision },
    clue: w.clue,
    lore: w.lore,
    mystery: w.mystery,
  };
  if (state === 'sealed') return { ...base, state };
  return {
    ...base,
    state,
    trial: w.trial,
    person: toKeeper(w.person),
    earns: w.earns,
    steps: (w.steps ?? []).map(toStep),
    inkedOn: w.inkedOn,
    note: w.note,
    links: { eventId: w.eventId, ideaId: w.ideaId, chapterId: w.chapterId, reminderId: w.reminderId },
  };
}

function toScroll(road: RoadRow, rows: WaypointRow[]): WishScroll {
  const q = road.quest;
  const byPosition = new Map(rows.map((w) => [w.position, w]));
  const map = rows.map((w) => toWaypoint(w, stateOf(w, byPosition.get(w.position - 1))));
  return {
    id: road.id,
    n: road.n,
    status: road.status,
    phase: roadPhase(road.status),
    signs: road.signs,
    attempts: road.attempts,
    readyAt: isoOrNull(road.readyAt),
    title: q?.title ?? null,
    calling: q?.calling ?? null,
    truth: q?.truth ?? null,
    span: q?.span ? { amount: q.span.amount, unit: q.span.unit } : null,
    map,
    thisWeek: q?.thisWeek
      ? {
          text: q.thisWeek.text,
          mark: toMark(q.thisWeek.mark),
          day: q.thisWeek.day ?? null,
          minutes: q.thisWeek.minutes,
          reminderId: road.thisWeekReminderId,
        }
      : null,
    provisions: q?.provisions ? toProvisions(q.provisions) : null,
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

function toWish(wish: WishRow, road: RoadRow, rows: WaypointRow[]): Wish {
  return {
    id: wish.id,
    text: wish.text,
    status: wish.status,
    createdAt: iso(wish.createdAt),
    realm: wish.realm.label,
    beyond: (wish.weighing?.tags ?? []).includes('beyond'),
    road: toScroll(road, rows),
    inked: rows.filter((w) => w.inkedAt).length,
    total: rows.length,
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

export async function loracleRoutes(app: FastifyInstance, { db, world, config, mind }: AppContext) {
  const jobs = app.wishJobs;

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

  // --- Loaders (visibility lives in lib/access.ts: the Lorer's own, 404 for anyone else) ----

  const loadOwnWish = (me: string, id: string): Promise<WishRow> => loadVisibleWish(db, me, id);

  async function roadOf(wishId: string): Promise<RoadRow> {
    const [road] = await db.select().from(wishRoads).where(eq(wishRoads.wishId, wishId)).orderBy(asc(wishRoads.n)).limit(1);
    if (!road) throw notFound('That wish');
    return road;
  }

  async function wishView(me: string, wishId: string): Promise<Wish> {
    const wish = await loadOwnWish(me, wishId);
    const road = await roadOf(wish.id);
    const rows = await db
      .select()
      .from(wishWaypoints)
      .where(eq(wishWaypoints.roadId, road.id))
      .orderBy(asc(wishWaypoints.position));
    return toWish(wish, road, rows);
  }

  async function loadOwnWaypoint(me: string, id: string) {
    const found = await loadVisibleWaypoint(db, me, id);
    const [previous] = await db
      .select({ inkedAt: wishWaypoints.inkedAt })
      .from(wishWaypoints)
      .where(and(eq(wishWaypoints.roadId, found.waypoint.roadId), eq(wishWaypoints.position, found.waypoint.position - 1)))
      .limit(1);
    return { ...found, state: stateOf(found.waypoint, previous) };
  }

  /** A waypoint the Lorer may act on: sealed ones answer 409 until their seal is broken. */
  async function loadOpenWaypoint(me: string, params: unknown) {
    const found = await loadOwnWaypoint(me, idParam(params));
    if (found.state === 'sealed') throw sealedError();
    return found;
  }

  const loadOwnRoad = (me: string, id: string) => loadVisibleRoad(db, me, id);

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

  /** The stone's face: its mind, the Lorer's answers to its questions, the examples and the quest log. */
  app.get('/loracle', async (req): Promise<LoracleState> => {
    const me = requireUser(req);
    jobs.sweepSoon();
    const row = await settingsRow(me);
    const [active, letGo] = await Promise.all([
      wishSummaries(db, me, { letGo: false, limit: 30 }),
      wishSummaries(db, me, { letGo: true, limit: 10 }),
    ]);
    return {
      mind: mindState(mind),
      consented: !!row?.loracleConsentAt,
      settings: toSettings(row),
      examples: loracleExamples(isoWeek(new Date())),
      wishes: active,
      letGo,
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

      // Past the owner's ceiling the wish is written and waits for the new moon.
      const moon = await pastTheMoon(db, config.loracle);
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
          .values({ wishId: wish!.id, n: 1, status: 'queued', signs: [signLine({ kind: 'listening' })] })
          .returning({ id: wishRoads.id });
        return { wishId: wish!.id, roadId: road!.id };
      });
      await recordSpend(db, spend, { userId: me, wishId, day });
      if (!moon) jobs.start({ roadId, wishId, userId: me });
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
    const road = await roadOf(wish.id);
    let set: { status: WishStatus; fulfilledAt?: Date | null; releasedAt?: Date | null };
    switch (input.status) {
      case 'fulfilled':
        if (!road.quest) throw notReady();
        set = { status: 'fulfilled', fulfilledAt: wish.fulfilledAt ?? new Date(), releasedAt: null };
        break;
      case 'released':
        set = { status: 'released', releasedAt: new Date() };
        break;
      case 'revealed':
        set = { status: road.quest ? 'revealed' : road.status === 'silent' ? 'silent' : 'faded', fulfilledAt: null, releasedAt: null };
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
   * "Try again" on a faded road: once a day per road, only while the Lorer lets the stone read and
   * is under the hidden limit (the road itself already counts toward it while its spend is recent).
   */
  app.post(
    '/loracle/wishes/:id/retry',
    { config: { rateLimit: { ...CAST_RATE, keyGenerator: (req) => req.userId ?? req.ip } } },
    async (req, reply): Promise<Wish> => {
      const me = requireUser(req);
      const wish = await loadOwnWish(me, idParam(req.params));
      if (!mind) throw asleep();
      const settings = await settingsRow(me);
      if (!settings?.loracleConsentAt) throw new HttpError(403, 'consent', LORACLE_LINES.consentTitle);
      const road = await roadOf(wish.id);
      if (road.status !== 'faded') throw new HttpError(409, 'not_faded', 'The fog has not won this one.');
      const today = localDay(new Date(), wish.timeZone);
      if (road.retriedOn === today) throw new HttpError(409, 'retried', LORACLE_LINES.retried);
      if ((await castsInLast24h(db, me)) >= config.loracle.castsPer24h) throw new HttpError(409, 'rest', LORACLE_LINES.rest);
      const moon = await pastTheMoon(db, config.loracle);
      const retried = await db.transaction(async (tx) => {
        const rows = await tx
          .update(wishRoads)
          .set({
            status: 'queued',
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

  /** "Make it a plan": a private event with the Lorer as organizer, linked back to the waypoint. */
  app.post('/loracle/waypoints/:id/plan', async (req, reply): Promise<Wish> => {
    const me = requireUser(req);
    const { waypoint: w, wish } = await loadOpenWaypoint(me, req.params);
    const input = parse(PlanWaypointInput, req.body ?? {});
    if (w.eventId) return wishView(me, wish.id);
    const road = await roadOf(wish.id);
    const today = localDay(new Date(), wish.timeZone);
    const fromAt = dayFromAt(w.at);
    const day = input.day ?? (fromAt && fromAt >= today ? fromAt : addDays(today, 7));
    await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          title: w.name.slice(0, 120),
          description: [w.trial, w.clue, road.quest?.title ? `A waypoint on ${road.quest.title}, drawn by The Loracle.` : null]
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
    });
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
}
