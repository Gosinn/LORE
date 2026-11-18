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
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  ROAD_IN_PROGRESS,
  signLine,
  signPhase,
  type LoracleContext,
  type LoracleSign,
  type RoadStatus,
  type WishFailure,
} from '#shared';
import type { LoracleConfig } from '../../config.ts';
import type { Db } from '../../db/index.ts';
import { loracleSpend, oracleSettings, wishes, wishRoads, wishWaypoints } from '../../db/schema.ts';
import type { WorldData } from '../world.ts';
import { drawPins, type Pin } from './draw.ts';
import {
  MindError,
  PHASE_STATUS,
  type CastDraft,
  type LoracleMind,
  type MindContext,
  type SpendEntry,
  type WeighedWish,
} from './types.ts';

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

/** The Lorer's calendar day (YYYY-MM-DD) in their zone. */
export const localDay = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

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
  who: { userId: string | null; wishId: string | null; day: string | null; roadId?: string | null },
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
const consentOf = (userIdColumn: typeof wishes.userId) =>
  sql`exists (select 1 from ${oracleSettings} where ${oracleSettings.userId} = ${userIdColumn} and ${oracleSettings.loracleConsentAt} is not null)`;

/**
 * "Stop sending wishes": every road of this Lorer still waiting to be drawn (queued, being drawn,
 * or waiting for the new moon) fades, so nothing more of theirs goes to Anthropic. Scrolls already
 * written stay. Call after the Lorer's jobs were aborted.
 */
export async function fadeUnsent(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const waiting = await tx
      .select({ id: wishes.id })
      .from(wishes)
      .where(and(eq(wishes.userId, userId), inArray(wishes.status, ['listening', 'moon'])));
    if (!waiting.length) return;
    const ids = waiting.map((w) => w.id);
    await tx
      .update(wishRoads)
      .set({ status: 'faded', failure: 'interrupted', runId: null, updatedAt: new Date() })
      .where(and(inArray(wishRoads.wishId, ids), inArray(wishRoads.status, ['queued', 'searching', 'drawing', 'sealing'])));
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
        inArray(loracleSpend.stage, ['road', 'keepers', 'compose', 'repair']),
        gte(loracleSpend.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  const drawing = await db
    .select({ key: wishRoads.id })
    .from(wishRoads)
    .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
    // Moon wishes count too: past the owner's ceiling a wish is written without a compose, and
    // without this a Lorer could stack wishes for the new moon past the hidden limit.
    .where(
      and(
        eq(wishes.userId, userId),
        inArray(wishes.status, ['listening', 'moon']),
        inArray(wishRoads.status, [...ROAD_IN_PROGRESS]),
      ),
    );
  return new Set([...spent.map((r) => r.key), ...drawing.map((r) => r.key)]).size;
}

// ---------------------------------------------------------------------------
// The runner

/** A road to draw, with whose it is (one job per Lorer at a time). */
export interface RoadJob {
  roadId: string;
  wishId: string;
  userId: string;
}

export interface WishJobs {
  /** Queue a road whose status is `queued` (FIFO; one per Lorer; `maxConcurrent` at once). */
  start(job: RoadJob): void;
  /** Stop everything for a wish (it is being burned). Its rows are left for the caller to delete. */
  abort(wishId: string): void;
  /** Stop everything for a Lorer ("Stop sending wishes"). Their rows are left for the caller. */
  abortLorer(userId: string): void;
  /** Shutdown: stop every job and write nothing; the next boot's sweep picks the roads up again. */
  abortAll(): void;
  /** Resolves when nothing is running, waiting or about to retry (tests). */
  idle(): Promise<void>;
  /**
   * Stale roads (interrupted: retried once, else faded), orphaned queued roads, pins that never
   * finished, and moon wishes once the month's spend allows. `boot` treats a road in progress as
   * interrupted once it has missed two heartbeats (a fresh process runs nothing yet, but on an
   * overlapping deploy the old process may still be drawing it).
   */
  sweep(opts?: { boot?: boolean }): Promise<void>;
  /** The lazy sweep for GET routes: runs in the background, at most every few seconds. */
  sweepSoon(): void;
  /** abortAll, then wait for the jobs to let go (app close). */
  close(): Promise<void>;
}

const jobRegistry = new WeakMap<Db, WishJobs>();

/** The runner working on this database, if any (account deletion aborts a Lorer's jobs through it). */
export const wishJobsFor = (db: Db): WishJobs | undefined => jobRegistry.get(db);

interface Running {
  job: RoadJob;
  controller: AbortController;
  /** Why it was stopped from outside: nothing is written for either. */
  reason: 'shutdown' | 'burn' | null;
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

  const queue: RoadJob[] = [];
  const running = new Map<string, Running>(); // by road id
  const busyLorers = new Set<string>();
  const retryTimers = new Map<string, { timer: NodeJS.Timeout; job: RoadJob; done: () => void }>();
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
  const holds = (roadId: string) =>
    running.has(roadId) || retryTimers.has(roadId) || drawing.has(roadId) || queue.some((q) => q.roadId === roadId);

  function start(job: RoadJob) {
    if (stopped || !mind || holds(job.roadId)) return;
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

  function launch(job: RoadJob) {
    const r: Running = { job, controller: new AbortController(), reason: null };
    running.set(job.roadId, r);
    busyLorers.add(job.userId);
    track(
      attempt(r)
        .catch((err: unknown) => log.error({ err, wishId: job.wishId, roadId: job.roadId }, 'loracle: job crashed'))
        .finally(() => {
          running.delete(job.roadId);
          busyLorers.delete(job.userId);
          pump();
        }),
    );
  }

  function scheduleRetry(job: RoadJob, failure: WishFailure) {
    if (stopped) return;
    let done!: () => void;
    const waited = new Promise<void>((resolve) => (done = resolve));
    const timer = setTimeout(() => {
      retryTimers.delete(job.roadId);
      done();
      start(job);
    }, retryDelayMs(failure));
    retryTimers.set(job.roadId, { timer, job, done });
    track(waited);
  }

  /** One attempt at a road. Never throws for the mind's failures (they are written to the road). */
  async function attempt(r: Running): Promise<void> {
    const { roadId, wishId, userId } = r.job;
    if (!mind) return;

    // Past the owner's ceiling the wish waits for the new moon.
    if (await pastTheMoon(db, config)) {
      await db
        .update(wishes)
        .set({ status: 'moon', updatedAt: new Date() })
        .where(and(eq(wishes.id, wishId), eq(wishes.status, 'listening')));
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
          sql`exists (select 1 from ${wishes} where ${wishes.id} = ${wishRoads.wishId} and ${wishes.status} = 'listening' and ${consentOf(wishes.userId)})`,
        ),
      )
      .returning({ attempts: wishRoads.attempts });
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

    try {
      let draft: CastDraft;
      // Kept apart from the race: when an abort wins, this still says what was paid for.
      const castP = mind.cast(weighed, ctx, onSign, signal, { deadline });
      castP.catch(() => undefined);
      try {
        const aborted = new Promise<never>((_, reject) => {
          const fail = () => reject(new MindError(timeout.aborted ? 'timeout' : 'interrupted'));
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail, { once: true });
        });
        aborted.catch(() => undefined);
        draft = await Promise.race([castP, aborted]);
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
            .set({ status: 'silent', runId: null, heartbeatAt: new Date(), updatedAt: new Date() })
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

      const { waypoints, ...quest } = draft.road;
      const wrote = await db.transaction(async (tx) => {
        const rows = await tx
          .update(wishRoads)
          .set({
            status: 'ready',
            quest,
            forge: (draft.forge ?? null) as object | null,
            faults: draft.faults,
            rough: draft.rough,
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
        await tx
          .update(wishes)
          .set({ ledger: draft.ledger, ledgerAt: draft.ledger ? new Date() : null, updatedAt: new Date() })
          .where(eq(wishes.id, wishId));
        await tx
          .update(wishes)
          .set({ status: 'revealed' })
          .where(and(eq(wishes.id, wishId), eq(wishes.status, 'listening')));
        return true;
      });
      log.info(
        {
          wishId,
          roadId,
          ms: Date.now() - startedAt,
          attempts: claimed.attempts,
          waypoints: waypoints.length,
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
   * stone never reads it); anything else (burned, already claimed, moon) is left as it is.
   */
  async function fadeWithoutConsent(roadId: string, wishId: string) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(wishRoads)
        .set({ status: 'faded', failure: 'interrupted', runId: null, updatedAt: new Date() })
        .where(
          and(
            eq(wishRoads.id, roadId),
            eq(wishRoads.status, 'queued'),
            sql`exists (select 1 from ${wishes} where ${wishes.id} = ${wishRoads.wishId} and ${wishes.status} = 'listening' and not ${consentOf(wishes.userId)})`,
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

  /** A failed attempt: queue the automatic retry, or let the road fade. */
  async function failAttempt(job: RoadJob, runId: string, failure: WishFailure, attempts: number) {
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
      job: { roadId, wishId: '', userId: '' },
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

    // 1. Roads in progress that nobody here works on.
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
      .where(inArray(wishRoads.status, ['searching', 'drawing', 'sealing', 'ready']));
    for (const road of open) {
      if (holds(road.roadId) || redrawing.has(road.roadId)) continue;
      const quietFor = road.heartbeatAt ? now - road.heartbeatAt.getTime() : Infinity;
      if (quietFor < (boot ? 2 * HEARTBEAT_MS : STALE_MS)) continue;
      if (road.status === 'ready') {
        redraw(road.roadId, road.runId);
        continue;
      }
      const job: RoadJob = { roadId: road.roadId, wishId: road.wishId, userId: road.userId };
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
        if (rows.length) start(job);
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

    // 2. Queued roads of listening wishes that no queue here holds (lost with a restart).
    const queued = await db
      .select({ roadId: wishRoads.id, wishId: wishRoads.wishId, userId: wishes.userId })
      .from(wishRoads)
      .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
      .where(and(eq(wishRoads.status, 'queued'), eq(wishes.status, 'listening')))
      .orderBy(asc(wishes.createdAt));
    for (const job of queued) if (!holds(job.roadId)) start(job);

    // 3. The new moon: wishes written past the ceiling are read once the month allows.
    if (!(await pastTheMoon(db, config))) {
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
            .set({ signs: sql`array_append(${wishRoads.signs}, ${signLine({ kind: 'moon' })})`, updatedAt: new Date() })
            .where(eq(wishRoads.id, job.roadId));
          return true;
        });
        if (woke) start(job);
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

  const jobs: WishJobs = {
    start,
    abort(wishId) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.wishId === wishId) queue.splice(i, 1);
      for (const [roadId, t] of retryTimers) {
        if (t.job.wishId !== wishId) continue;
        clearTimeout(t.timer);
        retryTimers.delete(roadId);
        t.done();
      }
      for (const r of [...running.values(), ...redrawing.values()]) {
        if (r.job.wishId !== wishId) continue;
        r.reason ??= 'burn';
        r.controller.abort();
      }
    },
    abortLorer(userId) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.userId === userId) queue.splice(i, 1);
      for (const [roadId, t] of retryTimers) {
        if (t.job.userId !== userId) continue;
        clearTimeout(t.timer);
        retryTimers.delete(roadId);
        t.done();
      }
      for (const r of running.values()) {
        if (r.job.userId !== userId) continue;
        r.reason ??= 'burn';
        r.controller.abort();
      }
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
    async close() {
      jobs.abortAll();
      await jobs.idle();
    },
  };
  jobRegistry.set(db, jobs);
  return jobs;
}
