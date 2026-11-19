// The Loracle's job runner: draws a wish's road in the background, in this process.
//
// A cast stores the wish and its road (`queued`) and calls `start`. A job then:
//   claims the road (new run id, status `searching`, attempts + 1)
//   → mind.cast (signs are retold with signLine and move the status forward, never back)
//   → writes the scroll (status `ready`, waypoints, wish `revealed`) in one guarded transaction
//   → draws the pins with the world's geocoder (status `drawn`).
//
// Every write from a job is guarded by `where id = road and run_id = this run`: a burned wish, a
// road taken over after a restart, or an account deletion makes the guard match nothing, and the
// job stops without writing. A heartbeat every 20 s keeps the run alive and notices the same.
//
// Failures: one automatic retry (after 30 s when the mind was overloaded), then the road fades and
// the Lorer gets a free "Try again" (one a day). On shutdown the rows are left in progress; the
// sweep marks them interrupted once they go quiet and retries them under the same rule. Past the
// owner's monthly ceiling a wish waits for the new moon (status `moon`); the sweep wakes it when the
// month's spend allows. A road is only ever claimed while its Lorer still lets the stone read
// (consent); otherwise it fades, and "Stop sending wishes" fades every road still waiting.
//
// Money is always counted: when a job is cut off (burn, timeout, shutdown) it waits a moment for
// the mind to say what it already paid for, and records that before anything else.
//
// Logs carry ids, stages, timings, counts and cost only: never the wish, the context or the scroll.
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNotNull, isNull, ne, notInArray, or, sql, type AnyColumn } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  ROAD_IN_PROGRESS,
  signLine,
  signPhase,
  type LoracleContext,
  type LoracleSign,
  type QuestSource,
  type RoadLane,
  type RoadStatus,
  type WishFailure,
} from '#shared';
import type { LoracleConfig } from '../../config.ts';
import type { Db } from '../../db/index.ts';
import { loracleSpend, oracleSettings, wishAsks, wishes, wishRoads, wishWaypoints } from '../../db/schema.ts';
import type { WorldData } from '../world.ts';
import { drawPins, type Pin } from './draw.ts';
import { localDay } from './time.ts';
import {
  MindError,
  PHASE_STATUS,
  ROAD_STAGES,
  type CastDraft,
  type DeeperAsk,
  type DeeperDraft,
  type DeeperFocus,
  type DrawFrom,
  type EarlierRoad,
  type LoracleMind,
  type MindContext,
  type SpendEntry,
  type WeighedWish,
} from './types.ts';

export { localDay } from './time.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How often a running job proves it is alive. */
const HEARTBEAT_MS = 20_000;
/** A road in progress that nobody here works on, quiet this long, was interrupted. */
export const STALE_MS = 90_000;
/** The lazy sweep (GET /loracle, GET a wish) runs at most this often. */
const SWEEP_EVERY_MS = 5_000;
/** Attempts before a road fades: the first, plus one automatic retry. */
const MAX_ATTEMPTS = 2;
/** How long a cut-off job waits for the mind to report what it already paid for. */
export const LATE_SPEND_MS = 10_000;

/** A road moves forward only. */
const STATUS_ORDER: Record<RoadStatus, number> = {
  queued: 0,
  searching: 1,
  drawing: 2,
  sealing: 3,
  ready: 4,
  drawn: 5,
  faded: 6,
  silent: 6,
};

// ---------------------------------------------------------------------------
// Small shared helpers (the routes use these too)

/** "Wednesday 18 November 2026", in the Lorer's zone. */
export const dayInWords = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(at);

/** sha256(salt + user id), first 32 hex characters: the only "who" the mind is told (metadata.user_id). */
export const anonIdFor = (salt: string, userId: string) =>
  createHash('sha256').update(`${salt}${userId}`).digest('hex').slice(0, 32);

export const EMPTY_CONTEXT: LoracleContext = {
  age: null,
  money: null,
  time: null,
  body: null,
  languages: null,
  passport: null,
  callings: [],
};

/** A complete context from whatever was kept (older rows may lack fields). */
export const fullContext = (c: Partial<LoracleContext> | null | undefined): LoracleContext => ({
  ...EMPTY_CONTEXT,
  ...(c ?? {}),
  callings: [...(c?.callings ?? [])],
});

/** The town part of a realm label ("Reykjavík, Capital Region, Iceland" → "Reykjavík"). */
const townPart = (label: string) => label.split(',')[0]!.trim() || label.trim();

/**
 * What the mind is told (see lib/loracle/types.ts MindContext). Never a name, id or coordinates:
 * of the realm, only its town and country leave the server.
 */
export function mindContextFor(opts: {
  realm: { label: string; country: string };
  reachKm: number;
  context: LoracleContext;
  timeZone: string;
  userId: string;
  anonSalt: string;
  now?: Date;
}): MindContext {
  const now = opts.now ?? new Date();
  const { callings, ...lorer } = fullContext(opts.context);
  return {
    realm: { label: townPart(opts.realm.label), country: opts.realm.country },
    reachKm: opts.reachKm,
    callings,
    lorer,
    today: dayInWords(now, opts.timeZone),
    todayIso: localDay(now, opts.timeZone),
    timeZone: opts.timeZone,
    anonId: anonIdFor(opts.anonSalt, opts.userId),
  };
}

const fkViolation = (err: unknown) => {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === '23503') return true;
  }
  return false;
};

/**
 * One loracle_spend row per model request. Stores no text. Money spent is always recorded: when
 * the wish was burned meanwhile the row keeps the Lorer and the road (so a burn never refunds a
 * cast), and when the account is gone too it keeps neither.
 */
export async function recordSpend(
  db: Db,
  entries: readonly SpendEntry[],
  who: { userId: string | null; wishId: string | null; day: string | null; roadId?: string | null; askId?: string | null; lane?: RoadLane },
): Promise<void> {
  if (!entries.length) return;
  const utcDay = new Date().toISOString().slice(0, 10);
  const rows = (userId: string | null, wishId: string | null) =>
    entries.map((e) => ({
      userId,
      wishId,
      utcDay,
      day: userId ? who.day : null,
      stage: e.stage,
      outcome: e.outcome,
      model: e.model,
      ms: Math.max(0, Math.round(e.ms)),
      inputTokens: Math.max(0, Math.round(e.inputTokens)),
      outputTokens: Math.max(0, Math.round(e.outputTokens)),
      cacheWriteTokens: Math.max(0, Math.round(e.cacheWriteTokens)),
      cacheReadTokens: Math.max(0, Math.round(e.cacheReadTokens)),
      searches: Math.max(0, Math.round(e.searches)),
      fetches: Math.max(0, Math.round(e.fetches)),
      costMicros: Math.max(0, Math.round(e.costMicros)),
      requestId: e.requestId,
      roadId: who.roadId ?? null,
      askId: who.askId ?? null,
      lane: who.lane ?? 'now',
    }));
  const attempts: [string | null, string | null][] = [
    [who.userId, who.wishId],
    [who.userId, null],
    [null, null],
  ];
  for (const [i, [userId, wishId]] of attempts.entries()) {
    try {
      await db.insert(loracleSpend).values(rows(userId, wishId));
      return;
    } catch (err) {
      if (!fkViolation(err) || i === attempts.length - 1) throw err;
    }
  }
}

/** What the stone has cost this UTC month, across everyone, in US$ × 1e6. */
export async function monthSpentMicros(db: Db, now = new Date()): Promise<number> {
  const firstOfMonth = `${now.toISOString().slice(0, 7)}-01`;
  const [row] = await db
    .select({ micros: sql<string>`coalesce(sum(${loracleSpend.costMicros}), 0)` })
    .from(loracleSpend)
    .where(gte(loracleSpend.utcDay, firstOfMonth));
  return Number(row?.micros ?? 0);
}

/** True when the owner's monthly ceiling is reached: new roads wait for the new moon. */
export async function pastTheMoon(db: Db, config: LoracleConfig): Promise<boolean> {
  return (await monthSpentMicros(db)) >= config.monthlyUsd * 1_000_000;
}

/**
 * Far past the ceiling (by FULL_MOON_MARGIN): nothing is weighed any more until the new moon. Between
 * the ceiling and this, wishes are still weighed and written for the new moon; past it, the
 * weighings themselves would run the owner's bill on without end.
 */
export const FULL_MOON_MARGIN = 1.1;
export async function farPastTheMoon(db: Db, config: LoracleConfig): Promise<boolean> {
  return (await monthSpentMicros(db)) >= config.monthlyUsd * FULL_MOON_MARGIN * 1_000_000;
}

/**
 * The spend of a mind call that lost a race to an abort (burn, timeout, shutdown, a closed
 * connection): wait up to `ms` for the call to settle and take what it says it paid for.
 */
export async function lateSpend(
  call: Promise<{ spend: SpendEntry[] }>,
  fallback: SpendEntry[],
  ms = LATE_SPEND_MS,
): Promise<SpendEntry[]> {
  let timer: NodeJS.Timeout | undefined;
  const waited = new Promise<SpendEntry[]>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      call.then(
        (r) => r.spend,
        (e: unknown) => (e instanceof MindError && e.spend.length ? e.spend : fallback),
      ),
      waited,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** True while the Lorer lets the stone read (consent given and not withdrawn). */
export const consentOf = (userIdColumn: AnyColumn) =>
  sql`exists (select 1 from ${oracleSettings} where ${oracleSettings.userId} = ${userIdColumn} and ${oracleSettings.loracleConsentAt} is not null)`;

/**
 * "Stop sending wishes": every road of this Lorer still waiting to be drawn (queued, being drawn,
 * or waiting for the new moon) fades, so nothing more of theirs goes to Anthropic. Scrolls already
 * written stay. Call after the Lorer's jobs were aborted.
 */
export async function fadeUnsent(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const mine = await tx.select({ id: wishes.id }).from(wishes).where(eq(wishes.userId, userId));
    if (!mine.length) return;
    const ids = mine.map((w) => w.id);
    // Every road still waiting (the cast's, "Ask again"'s, now or at dawn) and every deeper ask.
    await tx
      .update(wishRoads)
      .set({ status: 'faded', failure: 'interrupted', runId: null, batch: null, updatedAt: new Date() })
      .where(and(inArray(wishRoads.wishId, ids), inArray(wishRoads.status, [...ROAD_IN_PROGRESS])));
    await tx
      .update(wishAsks)
      .set({ status: 'faded', failure: 'interrupted', runId: null, batch: null, updatedAt: new Date() })
      .where(and(eq(wishAsks.userId, userId), inArray(wishAsks.status, ['listening', 'dawn'])));
    await tx
      .update(wishes)
      .set({ status: 'faded', updatedAt: new Date() })
      .where(and(inArray(wishes.id, ids), inArray(wishes.status, ['listening', 'moon'])));
  });
}

/**
 * Weighings this Lorer asked for in the last 24 hours that were paid and recorded (care rows carry
 * no Lorer, and a weighing cut off by a closed connection may record nothing: routes/loracle.ts also
 * counts attempts in memory).
 */
export async function weighsInLast24h(db: Db, userId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loracleSpend)
    .where(
      and(
        eq(loracleSpend.userId, userId),
        eq(loracleSpend.stage, 'weigh'),
        gte(loracleSpend.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Casts that count toward the hidden per-Lorer limit: every road the stone spent money drawing in
 * the last 24 hours, whether it was drawn, faded or burned (from loracle_spend's road ids, which
 * outlive a burn), plus roads still being drawn or waiting for the new moon. A road counts once,
 * however many attempts it took.
 */
export async function castsInLast24h(db: Db, userId: string, now = new Date()): Promise<number> {
  const spent = await db
    .selectDistinct({ key: sql<string>`coalesce(${loracleSpend.roadId}::text, ${loracleSpend.id}::text)` })
    .from(loracleSpend)
    .where(
      and(
        eq(loracleSpend.userId, userId),
        inArray(loracleSpend.stage, [...ROAD_STAGES]),
        gte(loracleSpend.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  const drawing = await db
    .select({ key: wishRoads.id })
    .from(wishRoads)
    .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
    // Moon wishes count too: past the owner's ceiling a wish is written without a compose, and
    // without this a Lorer could stack wishes for the new moon past the hidden limit. So do roads
    // waiting for dawn and "Ask again" roads still being drawn.
    .where(and(eq(wishes.userId, userId), inArray(wishRoads.status, [...ROAD_IN_PROGRESS])));
  return new Set([...spent.map((r) => r.key), ...drawing.map((r) => r.key)]).size;
}

/** Deeper asks this Lorer made in the last 24 hours (the hidden limit on asks; never shown). */
export async function asksInLast24h(db: Db, userId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wishAsks)
    .where(and(eq(wishAsks.userId, userId), gte(wishAsks.createdAt, new Date(now.getTime() - DAY_MS))));
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// The soft budget and the lanes (phase B; never shown, never a refusal)

/** What the stone has cost this UTC day, across everyone, in US$ × 1e6. */
export async function daySpentMicros(db: Db, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ micros: sql<string>`coalesce(sum(${loracleSpend.costMicros}), 0)` })
    .from(loracleSpend)
    .where(eq(loracleSpend.utcDay, now.toISOString().slice(0, 10)));
  return Number(row?.micros ?? 0);
}

/**
 * Roads this Lorer had drawn at once on their local day: the cast's and "Ask again"'s, in the now
 * lane, unless they faded or went silent (those never count).
 */
export async function nowRoadsOn(db: Db, userId: string, day: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wishRoads)
    .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
    .where(
      and(
        eq(wishes.userId, userId),
        eq(wishRoads.lane, 'now'),
        sql`coalesce(${wishRoads.day}, ${wishes.day}) = ${day}`,
        notInArray(wishRoads.status, ['faded', 'silent']),
      ),
    );
  return row?.n ?? 0;
}

/** Deeper asks this Lorer had answered at once on their local day (faded and silent ones don't count). */
export async function nowAsksOn(db: Db, userId: string, day: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wishAsks)
    .where(and(eq(wishAsks.userId, userId), eq(wishAsks.day, day), eq(wishAsks.lane, 'now'), notInArray(wishAsks.status, ['faded', 'silent'])));
  return row?.n ?? 0;
}

/**
 * The lane for a new cast or ask: `now`, or `dawn` once the Lorer's soft budget for their day is
 * spent (LORACLE_CASTS_NOW, LORACLE_DEEPER_NOW) or everyone's for the UTC day
 * (LORACLE_DAILY_BUDGET_USD). Always `now` while the dawn lane is off (no tick secret, no batches).
 */
export async function laneFor(
  db: Db,
  config: LoracleConfig,
  opts: { kind: 'cast' | 'ask'; userId: string; day: string; dawn: boolean; now?: Date },
): Promise<RoadLane> {
  if (!opts.dawn) return 'now';
  if ((await daySpentMicros(db, opts.now)) >= config.dailyBudgetUsd * 1_000_000) return 'dawn';
  const used = opts.kind === 'cast' ? await nowRoadsOn(db, opts.userId, opts.day) : await nowAsksOn(db, opts.userId, opts.day);
  return used >= (opts.kind === 'cast' ? config.castsNow : config.deeperNow) ? 'dawn' : 'now';
}

// ---------------------------------------------------------------------------
// What a road drawn from a ledger, or a deeper ask, is told

/** Every source the wish's roads cite (a phase A ledger is rebuilt from its dossiers and these). */
export function citedSources(roads: { quest: { sources?: QuestSource[] } | null }[]): QuestSource[] {
  const seen = new Set<string>();
  const out: QuestSource[] = [];
  for (const r of roads)
    for (const s of r.quest?.sources ?? []) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      out.push(s);
    }
  return out;
}

/** The roads already drawn, as the AGAIN addendum is told of them: their shape, keepers and trials in order. */
export async function earlierRoads(db: Db, wishId: string, exceptRoadId: string): Promise<EarlierRoad[]> {
  const roads = await db
    .select({ id: wishRoads.id, quest: wishRoads.quest })
    .from(wishRoads)
    .where(and(eq(wishRoads.wishId, wishId), ne(wishRoads.id, exceptRoadId)))
    .orderBy(asc(wishRoads.n));
  const drawn = roads.filter((r) => r.quest);
  if (!drawn.length) return [];
  const rows = await db
    .select({ roadId: wishWaypoints.roadId, person: wishWaypoints.person, name: wishWaypoints.name, place: wishWaypoints.place })
    .from(wishWaypoints)
    .where(inArray(wishWaypoints.roadId, drawn.map((r) => r.id)))
    .orderBy(asc(wishWaypoints.position));
  return drawn.map((r) => {
    const mine = rows.filter((p) => p.roadId === r.id);
    return {
      title: r.quest!.title,
      calling: r.quest!.calling,
      keepers: [...new Set(mine.filter((p) => p.person?.name).map((p) => p.person!.name!))],
      waypoints: mine.map((p) => ({ name: p.name, place: p.place })),
    };
  });
}

/** What a deeper ask lights: its waypoint and the road around it, without sources or note ids. */
export async function deeperFocusFor(db: Db, waypointId: string, question: string | null): Promise<DeeperFocus | null> {
  const [w] = await db.select().from(wishWaypoints).where(eq(wishWaypoints.id, waypointId)).limit(1);
  if (!w) return null;
  const [road] = await db.select({ quest: wishRoads.quest }).from(wishRoads).where(eq(wishRoads.id, w.roadId)).limit(1);
  const all = await db
    .select({ position: wishWaypoints.position, name: wishWaypoints.name, place: wishWaypoints.place, when: wishWaypoints.when })
    .from(wishWaypoints)
    .where(eq(wishWaypoints.roadId, w.roadId))
    .orderBy(asc(wishWaypoints.position));
  return {
    quest: { title: road?.quest?.title ?? '', calling: road?.quest?.calling ?? '', waypoints: all },
    waypoint: {
      position: w.position,
      name: w.name,
      when: w.when,
      place: w.place,
      town: w.town,
      country: w.country,
      clue: w.clue,
      trial: w.trial,
      person: w.person ? { name: w.person.name, role: w.person.role } : null,
      mystery: w.mystery,
      steps: (w.steps ?? []).map((s) => s.text),
    },
    question,
  };
}

// ---------------------------------------------------------------------------
// The runner

/** A road to draw, with whose it is (one job per Lorer at a time). */
export interface RoadJob {
  roadId: string;
  wishId: string;
  userId: string;
}

/** A deeper ask to answer (phase B), with whose it is. It shares the Lorer's one-at-a-time queue with roads. */
export interface AskJob {
  askId: string;
  wishId: string;
  userId: string;
}

export interface WishJobs {
  /** Queue a road whose status is `queued` in the now lane (FIFO; one per Lorer; `maxConcurrent` at once). */
  start(job: RoadJob): void;
  /** Queue a deeper ask that is `listening` in the now lane, with no run (phase B). */
  startAsk(job: AskJob): void;
  /** Stop everything for a wish (it is being burned). Its rows are left for the caller to delete. */
  abort(wishId: string): void;
  /** Stop everything for a Lorer ("Stop sending wishes"). Their rows are left for the caller. */
  abortLorer(userId: string): void;
  /** Shutdown: stop every job and write nothing; the next boot's sweep picks the roads up again. */
  abortAll(): void;
  /** Resolves when nothing is running, waiting or about to retry (tests). */
  idle(): Promise<void>;
  /**
   * Stale roads and asks (interrupted: retried once, else faded), orphaned queued ones, pins that
   * never finished, and moon wishes once the month's spend allows. `boot` treats a road in progress
   * as interrupted once it has missed two heartbeats (a fresh process runs nothing yet, but on an
   * overlapping deploy the old process may still be drawing it). The dawn lane's roads and asks are
   * the tick's (lib/loracle/dawn.ts), never the sweep's.
   */
  sweep(opts?: { boot?: boolean }): Promise<void>;
  /** The lazy sweep for GET routes: runs in the background, at most every few seconds. */
  sweepSoon(): void;
  /** Keep a promise in the jobs' books, so `idle()` waits for it (the dawn tick's work, tests). */
  track<T>(p: Promise<T>): Promise<T>;
  /** abortAll, then wait for the jobs to let go (app close). */
  close(): Promise<void>;
}

/**
 * The scroll, in one guarded transaction: the road `ready` with its quest, its waypoints, the
 * wish's ledger, and the wish `revealed` if it was still listening. False when the run was lost.
 */
export async function writeRoad(
  db: Db,
  roadId: string,
  wishId: string,
  guard: ReturnType<typeof and>,
  draft: Extract<CastDraft, { kind: 'road' }>,
): Promise<boolean> {
  const { waypoints, ...quest } = draft.road;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(wishRoads)
      .set({
        status: 'ready',
        quest,
        forge: (draft.forge ?? null) as object | null,
        faults: draft.faults,
        rough: draft.rough,
        batch: null,
        readyAt: new Date(),
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(guard)
      .returning({ id: wishRoads.id });
    if (!rows.length) return false;
    await tx.delete(wishWaypoints).where(eq(wishWaypoints.roadId, roadId));
    if (waypoints.length) {
      await tx.insert(wishWaypoints).values(
        waypoints.map((w, position) => {
          // The mind's own point (from its notes, or open sea) is kept; drawPins weighs it later.
          const pinned = w.where.lat != null && w.where.lon != null && w.where.precision != null;
          return {
            roadId,
            wishId,
            position,
            kind: w.kind,
            emblem: w.emblem,
            name: w.name,
            when: w.when,
            at: w.at,
            place: w.where.place,
            town: w.where.town,
            country: w.where.country,
            geoQuery: w.where.geoQuery,
            lat: pinned ? w.where.lat : null,
            lon: pinned ? w.where.lon : null,
            precision: pinned ? w.where.precision : null,
            clue: w.clue,
            lore: w.lore,
            trial: w.trial,
            person: w.person,
            earns: w.earns,
            mystery: w.mystery,
            steps: w.steps,
            noteIds: w.noteIds,
          };
        }),
      );
    }
    if (draft.ledger) {
      await tx.update(wishes).set({ ledger: draft.ledger, ledgerAt: new Date(), updatedAt: new Date() }).where(eq(wishes.id, wishId));
    }
    await tx
      .update(wishes)
      .set({ status: 'revealed', updatedAt: new Date() })
      .where(and(eq(wishes.id, wishId), eq(wishes.status, 'listening')));
    return true;
  });
}

const jobRegistry = new WeakMap<Db, WishJobs>();

/** The runner working on this database, if any (account deletion aborts a Lorer's jobs through it). */
export const wishJobsFor = (db: Db): WishJobs | undefined => jobRegistry.get(db);

type Job = ({ kind: 'road' } & RoadJob) | ({ kind: 'ask' } & AskJob);
const jobId = (j: Job) => (j.kind === 'road' ? j.roadId : j.askId);

interface Running {
  job: Job;
  controller: AbortController;
  /** Why it was stopped from outside: nothing is written for either. */
  reason: 'shutdown' | 'burn' | null;
}

/**
 * Race a mind call against the job's signal. When the abort wins, the call is kept apart so the
 * caller can still learn what it paid for (lateSpend).
 */
async function raced<T>(call: Promise<T>, signal: AbortSignal, timeout: AbortSignal): Promise<T> {
  call.catch(() => undefined);
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(new MindError(timeout.aborted ? 'timeout' : 'interrupted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  aborted.catch(() => undefined);
  return Promise.race([call, aborted]);
}

export function createWishJobs(opts: {
  db: Db;
  mind: LoracleMind | undefined;
  world: WorldData;
  config: LoracleConfig;
  log: FastifyBaseLogger;
  /** Wait before the automatic retry, per failure (default 30 s for overloaded, else none). */
  retryDelayMs?: (failure: WishFailure) => number;
}): WishJobs {
  const { db, mind, world, config, log } = opts;
  const retryDelayMs = opts.retryDelayMs ?? ((f: WishFailure) => (f === 'overloaded' ? 30_000 : 0));

  const queue: Job[] = [];
  const running = new Map<string, Running>(); // by road or ask id
  const busyLorers = new Set<string>();
  const retryTimers = new Map<string, { timer: NodeJS.Timeout; job: Job; done: () => void }>();
  const drawing = new Set<string>(); // road ids the sweep is re-drawing (claimed or about to be)
  const redrawing = new Map<string, Running>(); // the claimed ones, so a burn or shutdown can stop them
  const inflight = new Set<Promise<unknown>>();
  let stopped = false;
  let sweepChain: Promise<void> = Promise.resolve();
  let sweepsPending = 0;
  let lastSweep = 0;

  const track = <T>(p: Promise<T>) => {
    inflight.add(p);
    void p.finally(() => inflight.delete(p)).catch(() => undefined);
    return p;
  };
  const holds = (id: string) =>
    running.has(id) || retryTimers.has(id) || drawing.has(id) || queue.some((q) => jobId(q) === id);

  function enqueue(job: Job) {
    if (stopped || !mind || holds(jobId(job))) return;
    queue.push(job);
    pump();
  }

  function pump() {
    if (stopped) return;
    for (let i = 0; i < queue.length && running.size < config.maxConcurrent; ) {
      const job = queue[i]!;
      if (busyLorers.has(job.userId)) {
        i++;
        continue;
      }
      queue.splice(i, 1);
      launch(job);
    }
  }

  function launch(job: Job) {
    const r: Running = { job, controller: new AbortController(), reason: null };
    const id = jobId(job);
    running.set(id, r);
    busyLorers.add(job.userId);
    track(
      (job.kind === 'road' ? attempt(r) : attemptAsk(r))
        .catch((err: unknown) => log.error({ err, wishId: job.wishId, id }, 'loracle: job crashed'))
        .finally(() => {
          running.delete(id);
          busyLorers.delete(job.userId);
          pump();
        }),
    );
  }

  function scheduleRetry(job: Job, failure: WishFailure) {
    if (stopped) return;
    let done!: () => void;
    const waited = new Promise<void>((resolve) => (done = resolve));
    const id = jobId(job);
    const timer = setTimeout(() => {
      retryTimers.delete(id);
      done();
      enqueue(job);
    }, retryDelayMs(failure));
    retryTimers.set(id, { timer, job, done });
    track(waited);
  }

  /** One attempt at a road. Never throws for the mind's failures (they are written to the road). */
  async function attempt(r: Running): Promise<void> {
    if (r.job.kind !== 'road') return;
    const { roadId, wishId, userId } = r.job;
    if (!mind) return;

    // Past the owner's ceiling the wish waits for the new moon ("Ask again" roads wait as they are).
    if (await pastTheMoon(db, config)) {
      await db
        .update(wishes)
        .set({ status: 'moon', updatedAt: new Date() })
        .where(
          and(
            eq(wishes.id, wishId),
            eq(wishes.status, 'listening'),
            sql`exists (select 1 from ${wishRoads} where ${wishRoads.id} = ${roadId} and ${wishRoads.n} = 1)`,
          ),
        );
      return;
    }

    const runId = randomUUID();
    const [claimed] = await db
      .update(wishRoads)
      .set({
        status: 'searching',
        runId,
        attempts: sql`${wishRoads.attempts} + 1`,
        failure: null,
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wishRoads.id, roadId),
          eq(wishRoads.status, 'queued'),
          eq(wishRoads.lane, 'now'),
          // The cast's road while its wish listens; "Ask again"'s road on a wish already drawn.
          sql`exists (select 1 from ${wishes} where ${wishes.id} = ${wishRoads.wishId} and (${wishes.status} = 'listening' or (${wishRoads.n} > 1 and ${wishes.status} <> 'moon')) and ${consentOf(wishes.userId)})`,
        ),
      )
      .returning({ attempts: wishRoads.attempts, n: wishRoads.n, batch: wishRoads.batch });
    if (!claimed) {
      await fadeWithoutConsent(roadId, wishId);
      return;
    }
    const [wish] = await db.select().from(wishes).where(eq(wishes.id, wishId)).limit(1);
    if (!wish) return;

    const guard = and(eq(wishRoads.id, roadId), eq(wishRoads.runId, runId));
    const startedAt = Date.now();
    const deadline = startedAt + config.jobTimeoutMs;
    const timeout = AbortSignal.timeout(config.jobTimeoutMs);
    const signal = AbortSignal.any([r.controller.signal, timeout]);
    let lost = false;
    const loseRun = () => {
      if (lost) return;
      lost = true;
      r.reason ??= 'burn';
      r.controller.abort();
    };

    // Signs, written one after another; a guard that matches nothing means the run was lost.
    let status: RoadStatus = 'searching';
    let signWrites: Promise<void> = Promise.resolve();
    const onSign = (sign: LoracleSign) => {
      if (lost || signal.aborted) return;
      const phase = signPhase(sign);
      const next = phase ? PHASE_STATUS[phase] : null;
      const move = next && STATUS_ORDER[next] > STATUS_ORDER[status] ? next : null;
      if (move) status = move;
      const line = signLine(sign);
      signWrites = signWrites
        .then(async () => {
          if (lost) return;
          const rows = await db
            .update(wishRoads)
            .set({
              signs: sql`array_append(${wishRoads.signs}, ${line})`,
              ...(move && { status: move }),
              heartbeatAt: new Date(),
              updatedAt: new Date(),
            })
            .where(guard)
            .returning({ id: wishRoads.id });
          if (!rows.length) loseRun();
        })
        .catch((err: unknown) => log.warn({ err, wishId, roadId }, 'loracle: a sign could not be written'));
    };

    const heartbeat = setInterval(() => {
      void db
        .update(wishRoads)
        .set({ heartbeatAt: new Date() })
        .where(guard)
        .returning({ id: wishRoads.id })
        .then((rows) => {
          if (!rows.length) loseRun();
        })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const ctx = mindContextFor({
      realm: { label: wish.realm.label, country: wish.realm.country },
      reachKm: wish.realm.radiusKm,
      context: wish.context,
      timeZone: wish.timeZone,
      userId,
      anonSalt: config.anonSalt,
    });
    // The stored text carries a riddle answer already ("… — like a roaring crowd").
    const weighed: WeighedWish = { text: wish.text, riddleAnswer: null, rerouted: false, weighing: wish.weighing };
    const spendFor = { userId, wishId, day: wish.day, roadId };

    // "Ask again" draws from the wish's ledger; a dawn road whose scouts are done resumes from its own.
    const resumed = claimed.batch?.ledger ?? null;
    let from: DrawFrom | null = null;
    if (claimed.n > 1 || resumed) {
      const roads = await db.select({ quest: wishRoads.quest }).from(wishRoads).where(eq(wishRoads.wishId, wishId));
      const ledger = resumed ?? wish.ledger;
      if (ledger) {
        from = {
          task: claimed.n > 1 ? 'again' : 'quest',
          ledger,
          earlier: claimed.n > 1 ? await earlierRoads(db, wishId, roadId) : [],
          sources: citedSources(roads),
        };
      }
    }

    try {
      let draft: CastDraft;
      // Kept apart from the race: when an abort wins, this still says what was paid for.
      const castP = from ? mind.draw(weighed, ctx, from, onSign, signal, { deadline }) : mind.cast(weighed, ctx, onSign, signal, { deadline });
      try {
        draft = await raced(castP, signal, timeout);
      } catch (err) {
        await signWrites;
        let spend = err instanceof MindError ? err.spend : [];
        if (signal.aborted) spend = await lateSpend(castP, spend);
        await recordSpend(db, spend, spendFor);
        if (r.reason || lost) return; // shutdown or burn: write nothing more
        const failure: WishFailure = timeout.aborted ? 'timeout' : err instanceof MindError ? err.failure : 'error';
        log.warn(
          {
            wishId,
            roadId,
            failure,
            attempts: claimed.attempts,
            ms: Date.now() - startedAt,
            requestId: err instanceof MindError ? err.requestId : null,
            ...(err instanceof MindError ? {} : { err }),
          },
          'loracle: road attempt failed',
        );
        await failAttempt(r.job, runId, failure, claimed.attempts);
        return;
      }

      await signWrites;
      // Counted before anything is written, so a failed write never loses what was paid.
      await recordSpend(db, draft.spend, spendFor);
      if (r.reason || lost) return;

      if (draft.kind === 'silent') {
        const wrote = await db.transaction(async (tx) => {
          const rows = await tx
            .update(wishRoads)
            .set({ status: 'silent', runId: null, batch: null, heartbeatAt: new Date(), updatedAt: new Date() })
            .where(guard)
            .returning({ id: wishRoads.id });
          if (!rows.length) return false;
          await tx
            .update(wishes)
            .set({ status: 'silent', updatedAt: new Date() })
            .where(and(eq(wishes.id, wishId), eq(wishes.status, 'listening')));
          return true;
        });
        log.info({ wishId, roadId, ms: Date.now() - startedAt, outcome: 'silent', wrote }, 'loracle: road silent');
        return;
      }

      const wrote = await writeRoad(db, roadId, wishId, guard, draft);
      log.info(
        {
          wishId,
          roadId,
          n: claimed.n,
          ms: Date.now() - startedAt,
          attempts: claimed.attempts,
          waypoints: draft.road.waypoints.length,
          faults: draft.faults.length,
          rough: draft.rough,
          costUsd: draft.spend.reduce((sum, e) => sum + e.costMicros, 0) / 1e6,
          wrote,
        },
        'loracle: road ready',
      );
      if (!wrote) return;
      await draw(roadId, runId, signal);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * A queued road that could not be claimed. When its Lorer stopped sending wishes, it fades (the
   * stone never reads it); anything else (burned, already claimed, moon, the dawn lane) is left as it is.
   */
  async function fadeWithoutConsent(roadId: string, wishId: string) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(wishRoads)
        .set({ status: 'faded', failure: 'interrupted', runId: null, batch: null, updatedAt: new Date() })
        .where(
          and(
            eq(wishRoads.id, roadId),
            eq(wishRoads.status, 'queued'),
            sql`exists (select 1 from ${wishes} where ${wishes.id} = ${wishRoads.wishId} and (${wishes.status} = 'listening' or ${wishRoads.n} > 1) and not ${consentOf(wishes.userId)})`,
          ),
        )
        .returning({ id: wishRoads.id });
      if (!rows.length) return;
      await tx
        .update(wishes)
        .set({ status: 'faded', updatedAt: new Date() })
        .where(and(eq(wishes.id, wishId), eq(wishes.status, 'listening')));
    });
  }

  /** A failed attempt: queue the automatic retry, or let the road fade (the wish too, if it has no other road). */
  async function failAttempt(job: Job, runId: string, failure: WishFailure, attempts: number) {
    if (job.kind !== 'road') return;
    const guard = and(eq(wishRoads.id, job.roadId), eq(wishRoads.runId, runId));
    if (attempts < MAX_ATTEMPTS) {
      const rows = await db
        .update(wishRoads)
        .set({
          status: 'queued',
          failure,
          runId: null,
          signs: sql`array_append(${wishRoads.signs}, ${signLine({ kind: 'retry' })})`,
          updatedAt: new Date(),
        })
        .where(guard)
        .returning({ id: wishRoads.id });
      if (rows.length) scheduleRetry(job, failure);
      return;
    }
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(wishRoads)
        .set({ status: 'faded', failure, runId: null, updatedAt: new Date() })
        .where(guard)
        .returning({ id: wishRoads.id });
      if (!rows.length) return;
      await tx
        .update(wishes)
        .set({ status: 'faded', updatedAt: new Date() })
        .where(and(eq(wishes.id, job.wishId), eq(wishes.status, 'listening')));
    });
  }

  // ---- Deeper asks (phase B) ------------------------------------------------

  /** One attempt at a deeper ask. Never throws for the mind's failures (they are written to the ask). */
  async function attemptAsk(r: Running): Promise<void> {
    if (r.job.kind !== 'ask') return;
    const { askId, wishId, userId } = r.job;
    if (!mind) return;
    // Past the owner's ceiling the ask waits as it is; the sweep takes it up when the month allows.
    if (await pastTheMoon(db, config)) return;

    const runId = randomUUID();
    const [claimed] = await db
      .update(wishAsks)
      .set({ runId, attempts: sql`${wishAsks.attempts} + 1`, failure: null, heartbeatAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(wishAsks.id, askId),
          eq(wishAsks.status, 'listening'),
          eq(wishAsks.lane, 'now'),
          isNull(wishAsks.runId),
          consentOf(wishAsks.userId),
        ),
      )
      .returning({ attempts: wishAsks.attempts, waypointId: wishAsks.waypointId, question: wishAsks.question });
    if (!claimed) {
      // Its Lorer stopped sending wishes: it fades, unread.
      await db
        .update(wishAsks)
        .set({ status: 'faded', failure: 'interrupted', updatedAt: new Date() })
        .where(and(eq(wishAsks.id, askId), eq(wishAsks.status, 'listening'), isNull(wishAsks.runId), sql`not ${consentOf(wishAsks.userId)}`));
      return;
    }
    const guard = and(eq(wishAsks.id, askId), eq(wishAsks.runId, runId));
    const [wish] = await db.select().from(wishes).where(eq(wishes.id, wishId)).limit(1);
    const focus = await deeperFocusFor(db, claimed.waypointId, claimed.question);
    if (!wish || !focus) return;
    const roads = await db.select({ quest: wishRoads.quest }).from(wishRoads).where(eq(wishRoads.wishId, wishId));

    const startedAt = Date.now();
    const timeout = AbortSignal.timeout(config.jobTimeoutMs);
    const signal = AbortSignal.any([r.controller.signal, timeout]);
    let lost = false;
    const loseRun = () => {
      if (lost) return;
      lost = true;
      r.reason ??= 'burn';
      r.controller.abort();
    };
    let signWrites: Promise<void> = Promise.resolve();
    const onSign = (sign: LoracleSign) => {
      if (lost || signal.aborted) return;
      const line = signLine(sign);
      signWrites = signWrites
        .then(async () => {
          if (lost) return;
          const rows = await db
            .update(wishAsks)
            .set({ signs: sql`array_append(${wishAsks.signs}, ${line})`, heartbeatAt: new Date(), updatedAt: new Date() })
            .where(guard)
            .returning({ id: wishAsks.id });
          if (!rows.length) loseRun();
        })
        .catch((err: unknown) => log.warn({ err, askId }, 'loracle: a sign could not be written'));
    };
    const heartbeat = setInterval(() => {
      void db
        .update(wishAsks)
        .set({ heartbeatAt: new Date() })
        .where(guard)
        .returning({ id: wishAsks.id })
        .then((rows) => {
          if (!rows.length) loseRun();
        })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const ctx = mindContextFor({
      realm: { label: wish.realm.label, country: wish.realm.country },
      reachKm: wish.realm.radiusKm,
      context: wish.context,
      timeZone: wish.timeZone,
      userId,
      anonSalt: config.anonSalt,
    });
    const ask: DeeperAsk = {
      wish: { text: wish.text, riddleAnswer: null, rerouted: false, weighing: wish.weighing },
      ledger: wish.ledger ?? { notes: [], gaps: [] },
      sources: citedSources(roads),
      focus,
    };
    const spendFor = { userId, wishId, day: localDay(new Date(), wish.timeZone), askId };

    try {
      let answer: DeeperDraft;
      const askP = mind.deeper(ask, ctx, onSign, signal);
      try {
        answer = await raced(askP, signal, timeout);
      } catch (err) {
        await signWrites;
        let spend = err instanceof MindError ? err.spend : [];
        if (signal.aborted) spend = await lateSpend(askP, spend);
        await recordSpend(db, spend, spendFor);
        if (r.reason || lost) return;
        const failure: WishFailure = timeout.aborted ? 'timeout' : err instanceof MindError ? err.failure : 'error';
        log.warn({ wishId, askId, failure, attempts: claimed.attempts, ms: Date.now() - startedAt }, 'loracle: deeper ask failed');
        await failAsk(r.job, runId, failure, claimed.attempts);
        return;
      }
      await signWrites;
      await recordSpend(db, answer.spend, spendFor);
      if (r.reason || lost) return;
      if (answer.kind === 'silent') {
        await db.update(wishAsks).set({ status: 'silent', runId: null, updatedAt: new Date() }).where(guard);
        return;
      }
      const wrote = await db
        .update(wishAsks)
        .set({
          status: 'answered',
          answer: answer.answer,
          found: answer.found,
          rough: answer.rough,
          faults: answer.faults,
          runId: null,
          batch: null,
          answeredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(guard)
        .returning({ id: wishAsks.id });
      log.info({ wishId, askId, ms: Date.now() - startedAt, rough: answer.rough, faults: answer.faults.length, wrote: wrote.length > 0 }, 'loracle: deeper ask answered');
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** A failed ask: the automatic retry, or it fades (the Lorer may ask again). */
  async function failAsk(job: Job, runId: string, failure: WishFailure, attempts: number) {
    if (job.kind !== 'ask') return;
    const guard = and(eq(wishAsks.id, job.askId), eq(wishAsks.runId, runId));
    if (attempts < MAX_ATTEMPTS) {
      const rows = await db
        .update(wishAsks)
        .set({ failure, runId: null, signs: sql`array_append(${wishAsks.signs}, ${signLine({ kind: 'retry' })})`, updatedAt: new Date() })
        .where(guard)
        .returning({ id: wishAsks.id });
      if (rows.length) scheduleRetry(job, failure);
      return;
    }
    await db.update(wishAsks).set({ status: 'faded', failure, runId: null, updatedAt: new Date() }).where(guard);
  }

  /**
   * Pins (lib/loracle/draw.ts drawPins): the stone's notes → the place → its town → its country →
   * the mind's open-water point. The text is already on the scroll (`ready`); the road is `drawn`
   * when this ends, every waypoint pinned or not.
   */
  async function draw(roadId: string, runId: string, signal: AbortSignal) {
    const guard = and(eq(wishRoads.id, roadId), eq(wishRoads.runId, runId));
    const runIsMine = sql`exists (select 1 from ${wishRoads} where ${wishRoads.id} = ${roadId} and ${wishRoads.runId} = ${runId})`;
    const rows = await db
      .select({
        id: wishWaypoints.id,
        place: wishWaypoints.place,
        town: wishWaypoints.town,
        country: wishWaypoints.country,
        geoQuery: wishWaypoints.geoQuery,
        lat: wishWaypoints.lat,
        lon: wishWaypoints.lon,
        precision: wishWaypoints.precision,
      })
      .from(wishWaypoints)
      .where(eq(wishWaypoints.roadId, roadId))
      .orderBy(asc(wishWaypoints.position));
    let pins: (Pin | null)[];
    try {
      pins = await drawPins(
        rows.map(({ id: _id, ...where }) => ({ where })),
        (query) => world.geocode(query),
        signal,
      );
    } catch {
      return; // stopped (shutdown, burn or timeout): the sweep re-draws it later if it still stands
    }
    if (signal.aborted) return;
    for (const [i, pin] of pins.entries()) {
      const w = rows[i]!;
      if (!pin || (pin.lat === w.lat && pin.lon === w.lon && pin.precision === w.precision)) continue;
      const done = await db
        .update(wishWaypoints)
        .set({ lat: pin.lat, lon: pin.lon, precision: pin.precision })
        .where(and(eq(wishWaypoints.id, w.id), runIsMine))
        .returning({ id: wishWaypoints.id });
      if (!done.length) return; // the run was lost
    }
    await db
      .update(wishRoads)
      .set({ status: 'drawn', runId: null, heartbeatAt: new Date(), updatedAt: new Date() })
      .where(guard);
  }

  /** Re-draw the pins of a road whose text was written but whose drawing never finished. */
  function redraw(roadId: string, oldRunId: string | null) {
    if (stopped || drawing.has(roadId)) return;
    drawing.add(roadId);
    const controller = new AbortController();
    const r: Running = {
      job: { kind: 'road', roadId, wishId: '', userId: '' },
      controller,
      reason: null,
    };
    track(
      (async () => {
        const runId = randomUUID();
        const [claimed] = await db
          .update(wishRoads)
          .set({ runId, heartbeatAt: new Date() })
          .where(
            and(
              eq(wishRoads.id, roadId),
              eq(wishRoads.status, 'ready'),
              oldRunId ? eq(wishRoads.runId, oldRunId) : isNull(wishRoads.runId),
            ),
          )
          .returning({ id: wishRoads.id, wishId: wishRoads.wishId });
        if (!claimed) return;
        r.job.wishId = claimed.wishId;
        redrawing.set(roadId, r);
        await draw(roadId, runId, AbortSignal.any([controller.signal, AbortSignal.timeout(config.jobTimeoutMs)]));
      })()
        .catch((err: unknown) => log.warn({ err, roadId }, 'loracle: re-drawing pins failed'))
        .finally(() => {
          drawing.delete(roadId);
          redrawing.delete(roadId);
        }),
    );
  }

  async function sweepNow(boot: boolean) {
    if (!mind || stopped) return;
    const now = Date.now();

    // 1. Roads in progress in the now lane that nobody here works on.
    const open = await db
      .select({
        roadId: wishRoads.id,
        wishId: wishRoads.wishId,
        userId: wishes.userId,
        status: wishRoads.status,
        runId: wishRoads.runId,
        attempts: wishRoads.attempts,
        heartbeatAt: wishRoads.heartbeatAt,
      })
      .from(wishRoads)
      .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
      .where(and(inArray(wishRoads.status, ['searching', 'drawing', 'sealing', 'ready']), or(eq(wishRoads.lane, 'now'), eq(wishRoads.status, 'ready'))));
    for (const road of open) {
      if (holds(road.roadId) || redrawing.has(road.roadId)) continue;
      const quietFor = road.heartbeatAt ? now - road.heartbeatAt.getTime() : Infinity;
      if (quietFor < (boot ? 2 * HEARTBEAT_MS : STALE_MS)) continue;
      if (road.status === 'ready') {
        redraw(road.roadId, road.runId);
        continue;
      }
      const job: Job = { kind: 'road', roadId: road.roadId, wishId: road.wishId, userId: road.userId };
      const runGuard = and(
        eq(wishRoads.id, road.roadId),
        eq(wishRoads.status, road.status),
        road.runId ? eq(wishRoads.runId, road.runId) : isNull(wishRoads.runId),
      );
      if (road.attempts < MAX_ATTEMPTS) {
        const rows = await db
          .update(wishRoads)
          .set({
            status: 'queued',
            failure: 'interrupted',
            runId: null,
            signs: sql`array_append(${wishRoads.signs}, ${signLine({ kind: 'retry' })})`,
            updatedAt: new Date(),
          })
          .where(runGuard)
          .returning({ id: wishRoads.id });
        log.info({ wishId: road.wishId, roadId: road.roadId, attempts: road.attempts }, 'loracle: interrupted road retried');
        if (rows.length) enqueue(job);
      } else {
        await db.transaction(async (tx) => {
          const rows = await tx
            .update(wishRoads)
            .set({ status: 'faded', failure: 'interrupted', runId: null, updatedAt: new Date() })
            .where(runGuard)
            .returning({ id: wishRoads.id });
          if (!rows.length) return;
          await tx
            .update(wishes)
            .set({ status: 'faded', updatedAt: new Date() })
            .where(and(eq(wishes.id, road.wishId), eq(wishes.status, 'listening')));
        });
        log.info({ wishId: road.wishId, roadId: road.roadId, attempts: road.attempts }, 'loracle: interrupted road faded');
      }
    }

    // 2. Queued roads in the now lane that no queue here holds (lost with a restart): the cast's
    //    road of a listening wish, or an "Ask again" road.
    const queued = await db
      .select({ roadId: wishRoads.id, wishId: wishRoads.wishId, userId: wishes.userId })
      .from(wishRoads)
      .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
      .where(
        and(
          eq(wishRoads.status, 'queued'),
          eq(wishRoads.lane, 'now'),
          or(eq(wishes.status, 'listening'), and(sql`${wishRoads.n} > 1`, ne(wishes.status, 'moon'))),
        ),
      )
      .orderBy(asc(wishRoads.createdAt));
    for (const job of queued) if (!holds(job.roadId)) enqueue({ kind: 'road', ...job });

    // 3. The new moon: wishes written past the ceiling are read once the month allows.
    const moonOver = !(await pastTheMoon(db, config));
    if (moonOver) {
      const moons = await db
        .select({ roadId: wishRoads.id, wishId: wishes.id, userId: wishes.userId })
        .from(wishes)
        .innerJoin(wishRoads, and(eq(wishRoads.wishId, wishes.id), eq(wishRoads.status, 'queued')))
        // Only for Lorers who still let the stone read ("Stop sending wishes" fades the rest).
        .innerJoin(oracleSettings, and(eq(oracleSettings.userId, wishes.userId), isNotNull(oracleSettings.loracleConsentAt)))
        .where(eq(wishes.status, 'moon'))
        .orderBy(asc(wishes.createdAt));
      for (const job of moons) {
        const woke = await db.transaction(async (tx) => {
          const rows = await tx
            .update(wishes)
            .set({ status: 'listening', updatedAt: new Date() })
            .where(and(eq(wishes.id, job.wishId), eq(wishes.status, 'moon')))
            .returning({ id: wishes.id });
          if (!rows.length) return false;
          await tx
            .update(wishRoads)
            .set({ lane: 'now', signs: sql`array_append(${wishRoads.signs}, ${signLine({ kind: 'moon' })})`, updatedAt: new Date() })
            .where(eq(wishRoads.id, job.roadId));
          return true;
        });
        if (woke) enqueue({ kind: 'road', ...job });
      }
    }

    // 4. Deeper asks in the now lane: stale runs are interrupted (retried once, else faded); asks
    //    waiting with no run that no queue here holds are taken up.
    const asks = await db
      .select({
        askId: wishAsks.id,
        wishId: wishAsks.wishId,
        userId: wishAsks.userId,
        runId: wishAsks.runId,
        attempts: wishAsks.attempts,
        heartbeatAt: wishAsks.heartbeatAt,
      })
      .from(wishAsks)
      .where(and(eq(wishAsks.status, 'listening'), eq(wishAsks.lane, 'now')))
      .orderBy(asc(wishAsks.createdAt));
    for (const a of asks) {
      if (holds(a.askId)) continue;
      const job: Job = { kind: 'ask', askId: a.askId, wishId: a.wishId, userId: a.userId };
      if (!a.runId) {
        if (moonOver) enqueue(job);
        continue;
      }
      const quietFor = a.heartbeatAt ? now - a.heartbeatAt.getTime() : Infinity;
      if (quietFor < (boot ? 2 * HEARTBEAT_MS : STALE_MS)) continue;
      const runGuard = and(eq(wishAsks.id, a.askId), eq(wishAsks.runId, a.runId));
      if (a.attempts < MAX_ATTEMPTS) {
        const rows = await db
          .update(wishAsks)
          .set({ failure: 'interrupted', runId: null, signs: sql`array_append(${wishAsks.signs}, ${signLine({ kind: 'retry' })})`, updatedAt: new Date() })
          .where(runGuard)
          .returning({ id: wishAsks.id });
        if (rows.length && moonOver) enqueue(job);
      } else {
        await db.update(wishAsks).set({ status: 'faded', failure: 'interrupted', runId: null, updatedAt: new Date() }).where(runGuard);
      }
    }
    lastSweep = Date.now();
  }

  /** Sweeps run one after another; a sweep asked for always starts after the call (it sees the latest rows). */
  function sweep({ boot = false }: { boot?: boolean } = {}): Promise<void> {
    sweepsPending++;
    const run = sweepChain
      .catch(() => undefined)
      .then(() => sweepNow(boot))
      .finally(() => {
        sweepsPending--;
      });
    sweepChain = run;
    return track(run);
  }

  const stopWhere = (match: (job: Job) => boolean) => {
    for (let i = queue.length - 1; i >= 0; i--) if (match(queue[i]!)) queue.splice(i, 1);
    for (const [id, t] of retryTimers) {
      if (!match(t.job)) continue;
      clearTimeout(t.timer);
      retryTimers.delete(id);
      t.done();
    }
    for (const r of [...running.values(), ...redrawing.values()]) {
      if (!match(r.job)) continue;
      r.reason ??= 'burn';
      r.controller.abort();
    }
  };

  const jobs: WishJobs = {
    start: (job) => enqueue({ kind: 'road', ...job }),
    startAsk: (job) => enqueue({ kind: 'ask', ...job }),
    abort(wishId) {
      stopWhere((j) => j.wishId === wishId);
    },
    abortLorer(userId) {
      stopWhere((j) => j.userId === userId);
    },
    abortAll() {
      stopped = true;
      queue.length = 0;
      for (const t of retryTimers.values()) {
        clearTimeout(t.timer);
        t.done();
      }
      retryTimers.clear();
      for (const r of [...running.values(), ...redrawing.values()]) {
        r.reason ??= 'shutdown';
        r.controller.abort();
      }
    },
    async idle() {
      while (inflight.size) {
        await Promise.allSettled([...inflight]);
        if (!inflight.size && queue.length && !stopped) pump();
      }
    },
    sweep,
    sweepSoon() {
      if (!mind || stopped || sweepsPending || Date.now() - lastSweep < SWEEP_EVERY_MS) return;
      lastSweep = Date.now();
      sweep().catch((err: unknown) => log.warn({ err }, 'loracle: sweep failed'));
    },
    track,
    async close() {
      jobs.abortAll();
      await jobs.idle();
    },
  };
  jobRegistry.set(db, jobs);
  return jobs;
}
