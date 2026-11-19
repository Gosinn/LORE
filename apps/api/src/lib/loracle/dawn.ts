// The dawn lane (phase B): work written down past the stone's soft budget, read before the Lorer's
// next dawn at half the price, through Anthropic's Message Batches API.
//
// A road or a deeper ask in the dawn lane (lane `dawn`) keeps its state on its own row
// (`wish_roads.batch`, `wish_asks.batch`): the scouts' conversations, the ledger once built, and the
// compose/repair machine (lib/loracle/flow.ts). Each request is the live request minus `betas`,
// `fallbacks` and `stream` (lib/loracle/client.ts batchParams). The hourly tick:
//
//   1. collects ended batches: each result advances its road or ask by one step (a scout paused by
//      pause_turn is resent in the next batch; a road whose ledger is built moves on to compose; a
//      finished road is written as the live lane writes it, then its pins are drawn by the sweep)
//   2. keeps promises: anything due within 3 hours goes to the live lane now (unless past the
//      owner's monthly ceiling: a cast's wish then waits for the new moon, like any other)
//   3. submits one batch per stage for everything waiting, at most 5 begun items per Lorer at a
//      time (fair dawn: the rest roll on to the next night, their promise a day later). An item
//      within 5 hours of its promise is not begun at all (a batch round trip, scouts then compose,
//      would still be out when the promise keeper takes it live, and be paid for twice): the promise
//      keeper draws it live once. New items are begun only while the month's room under the owner's
//      ceiling, less what batches still out may cost, holds another one. Only for Lorers who still
//      let the stone read (consent).
//
// Failures: a request that errors with invalid_request (say, a tool batches turn out not to take)
// or that is refused (batch requests carry no fallbacks) goes to the live lane, where the job runs
// it with fallbacks; an expired, cancelled or otherwise errored request is sent again, and after
// three tries it goes live too. A result for a road or ask that was burned, went live or moved on is
// only counted (it was paid for). Money is always recorded, at batch prices.
//
// The tick is idempotent, and safe against itself across processes (a deploy's old and new instance):
// a batch is claimed once (ended_at, set before its results are taken), an item is claimed before its
// next request is built (its run id, swapped for a new one), an item only takes the results of the
// batch it is waiting on, and a second tick in a row finds nothing to do. A batch read and taken is
// deleted at Anthropic. It runs from POST /api/loracle/tick (GitHub Actions, hourly, a bearer secret)
// and lazily on boot and GET /loracle.
// Without the secret (or a key) the lane is off: every cast and ask is drawn at once, and anything
// still written down for dawn is handed to the live lane.
//
// Logs carry ids, stages, counts and cost only: never the wish, the context or the scroll.
import { randomUUID } from 'node:crypto';
import { APIError } from '@anthropic-ai/sdk';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { ROAD_IN_PROGRESS, signLine, type LoracleSign, type LoracleTickResult, type RoadStatus } from '#shared';
import type { LoracleConfig } from '../../config.ts';
import type { Db } from '../../db/index.ts';
import { loracleBatches, loracleSpend, wishAsks, wishes, wishRoads, wishWaypoints } from '../../db/schema.ts';
import { careFloor } from './care.ts';
import { checkDeeper, checkDraft } from './checks.ts';
import {
  MAX_RESENDS,
  allText,
  batchParams,
  composeParams,
  deeperParams,
  echoable,
  readStructured,
  scoutParams,
  type Block,
  type BatchClient,
  type BatchParams,
  type BatchResultLine,
  type Message,
  type RequestConfig,
} from './client.ts';
import { spendOf } from './cost.ts';
import { toDeeper, toRoad } from './draw.ts';
import {
  deeperFaults,
  deeperFeed,
  deeperFlow,
  deeperRequest,
  doneFaults,
  drawFeed,
  drawFlow,
  drawRequest,
  outcomeOf,
} from './flow.ts';
import {
  citedSources,
  consentOf,
  deeperFocusFor,
  earlierRoads,
  mindContextFor,
  monthSpentMicros,
  pastTheMoon,
  recordSpend,
  writeRoad,
  type WishJobs,
} from './jobs.ts';
import {
  SeenUrls,
  buildLedger,
  ledgerRecord,
  mergeDossier,
  nameKeepsComingUp,
  restoreLedger,
  seenFrom,
  weighsCost,
} from './ledger.ts';
import { MIN_NOTES, signer } from './mind.ts';
import { AGAIN_ADDENDUM, againTurn, composeTurn, deeperScoutTurn, deeperTurn, scoutTurn } from './prompts.ts';
import { DeeperWire, QuestDraftWire } from './schema.ts';
import type {
  AskDawnState,
  BatchItem,
  LoracleStage,
  MindContext,
  RoadDawnState,
  ScoutPart,
  SpendEntry,
  SpendOutcome,
  WeighedWish,
} from './types.ts';

const HOUR_MS = 60 * 60 * 1000;
/** The promise keeper: anything due within this goes live now. */
export const PROMISE_MS = 3 * HOUR_MS;
/** Fair dawn: dawn items a Lorer may have begun at once; the rest roll on to the next night. */
export const FAIR_SHARE = 5;
/** Batch failures in a row (errored, expired, cancelled) before an item goes live. */
const MAX_TRIES = 3;
/** A batch still not ended after this long is given up (batches expire after 24 hours). */
const LOST_BATCH_MS = 26 * HOUR_MS;
/** The lazy tick (boot, GET /loracle) runs at most this often. */
const LAZY_TICK_MS = 10 * 60_000;
/**
 * An item due within this is not begun in a batch: scouts, then compose, take at least two hourly
 * collections, and the promise keeper would take it live before they end (paid twice).
 */
export const LATE_MS = PROMISE_MS + 2 * HOUR_MS;
/** Fair-dawn extras due within this roll on to the next night (rather than going live). */
const ROLL_MS = PROMISE_MS + 3 * HOUR_MS;
/** What one dawn item may cost at batch prices, until 30 days of dawn spend say better (US$ × 1e6). */
export const DAWN_ITEM_MICROS = 500_000;
const IN_PROGRESS: readonly string[] = ROAD_IN_PROGRESS;

export interface DawnLane {
  /** Work past the soft budget goes to dawn: a tick secret, a batches client and a mind. */
  readonly on: boolean;
  /** One tick (single-flight: a tick asked for during another waits for it, then runs). */
  tick(now?: Date): Promise<LoracleTickResult>;
  /** The lazy tick for boot and GET /loracle: in the background, at most every 10 minutes. */
  tickSoon(): void;
}

type RoadRow = typeof wishRoads.$inferSelect;
type AskRow = typeof wishAsks.$inferSelect;
type WishRow = typeof wishes.$inferSelect;

/** A request ready for a batch, with whose it is. */
interface Pending {
  stage: 'scouts' | 'draw' | 'deeper-scout' | 'deeper';
  customId: string;
  part: string;
  params: BatchParams;
}

const SCOUT_STAGE: Record<ScoutPart['role'], LoracleStage> = { ROAD: 'road', KEEPERS: 'keepers', DEEPER: 'deeper-scout' };

/** Custom ids are [a-zA-Z0-9_-]{1,64}: the item's id without dashes and the part. */
const customIdOf = (kind: 'r' | 'a', id: string, part: string) => `${kind}_${id.replace(/-/g, '')}_${part}`.slice(0, 64);

/** The error type inside an errored batch result (BetaErrorResponse.error.type), when present. */
function errorTypeOf(line: BatchResultLine): string | null {
  if (line.result.type !== 'errored') return null;
  const e = line.result.error as { error?: { type?: unknown } } | undefined;
  return typeof e?.error?.type === 'string' ? e.error.type : null;
}

const scoutOutcome = (m: Message): SpendOutcome =>
  m.stop_reason === 'refusal' ? 'refusal' : m.stop_reason === 'max_tokens' ? 'max_tokens' : 'ok';

/** Take one scout reply into its part: its text, its URLs, a resend after pause_turn. */
function takeScout(part: ScoutPart, msg: Message, seen: SeenUrls, onBlock: (b: Block) => void): 'ok' | 'refusal' {
  for (const b of msg.content) {
    onBlock(b);
    seen.collect(b);
  }
  if (msg.stop_reason === 'refusal') {
    part.refused = true;
    part.done = true;
    return 'refusal';
  }
  part.texts.push(allText(msg.content));
  if (msg.stop_reason === 'pause_turn' && part.resends < MAX_RESENDS) {
    // Echo the paused turn back unchanged (no new user turn); the next batch continues it.
    part.messages.push({ role: 'assistant', content: echoable(msg.content) });
    part.resends++;
  } else {
    part.done = true;
  }
  return 'ok';
}

const newPart = (role: ScoutPart['role'], turn: string): ScoutPart => ({
  role,
  messages: [{ role: 'user', content: turn }],
  resends: 0,
  texts: [],
  done: false,
  refused: false,
});

export function createDawnLane(opts: {
  db: Db;
  config: LoracleConfig;
  batches: BatchClient | undefined;
  jobs: WishJobs;
  log: FastifyBaseLogger;
  /** Whether there is a mind at all (asleep: nothing is ever written for dawn). */
  awake: boolean;
}): DawnLane {
  const { db, config, batches, jobs, log } = opts;
  const on = !!config.tickSecret && !!batches && opts.awake;
  const reqCfg: RequestConfig = { model: config.model, effort: config.effort };
  let chain: Promise<unknown> = Promise.resolve();
  let lastTick = 0;

  const ctxFor = (wish: WishRow, userId: string, now = new Date()): MindContext =>
    mindContextFor({
      realm: { label: wish.realm.label, country: wish.realm.country },
      reachKm: wish.realm.radiusKm,
      context: wish.context,
      timeZone: wish.timeZone,
      userId,
      anonSalt: config.anonSalt,
      now,
    });
  const weighedOf = (wish: WishRow): WeighedWish => ({ text: wish.text, riddleAnswer: null, rerouted: false, weighing: wish.weighing });

  /** A batch reply's spend row (half price). */
  const paid = (stage: LoracleStage, msg: Message, outcome: SpendOutcome, batchId: string): SpendEntry =>
    spendOf(stage, outcome, msg, config.model, 0, batchId, { batch: true });

  // ---- Road signs and moves --------------------------------------------------

  async function roadSigns(roadId: string, runId: string | null, signs: LoracleSign[], status?: RoadStatus) {
    // Never on a road that faded meanwhile ("Stop sending wishes"), was burned or moved on.
    const guard = and(
      eq(wishRoads.id, roadId),
      runId ? eq(wishRoads.runId, runId) : undefined,
      inArray(wishRoads.status, [...ROAD_IN_PROGRESS]),
    );
    for (const s of signs) {
      await db
        .update(wishRoads)
        .set({ signs: sql`array_append(${wishRoads.signs}, ${signLine(s)})`, updatedAt: new Date() })
        .where(guard);
    }
    if (status) await db.update(wishRoads).set({ status, updatedAt: new Date() }).where(guard);
  }

  async function askSigns(askId: string, signs: LoracleSign[]) {
    for (const s of signs) {
      await db
        .update(wishAsks)
        .set({ signs: sql`array_append(${wishAsks.signs}, ${signLine(s)})`, updatedAt: new Date() })
        .where(eq(wishAsks.id, askId));
    }
  }

  /** Hand a dawn road to the live lane (its built ledger, if any, is kept: the job resumes from it). */
  async function roadLive(road: RoadRow, wish: WishRow, state: RoadDawnState | null, why: string): Promise<boolean> {
    const rows = await db
      .update(wishRoads)
      .set({
        lane: 'now',
        status: 'queued',
        runId: null,
        dueBy: null,
        batch: state ? { ...state, pending: null } : null,
        updatedAt: new Date(),
      })
      .where(and(eq(wishRoads.id, road.id), eq(wishRoads.lane, 'dawn'), inArray(wishRoads.status, [...ROAD_IN_PROGRESS])))
      .returning({ id: wishRoads.id });
    if (!rows.length) return false;
    log.info({ wishId: wish.id, roadId: road.id, why }, 'loracle dawn: road goes live');
    jobs.start({ roadId: road.id, wishId: wish.id, userId: wish.userId });
    return true;
  }

  async function askLive(ask: AskRow, why: string): Promise<boolean> {
    const rows = await db
      .update(wishAsks)
      .set({ lane: 'now', status: 'listening', runId: null, dueBy: null, batch: null, updatedAt: new Date() })
      .where(and(eq(wishAsks.id, ask.id), eq(wishAsks.lane, 'dawn'), eq(wishAsks.status, 'dawn')))
      .returning({ id: wishAsks.id });
    if (!rows.length) return false;
    log.info({ askId: ask.id, why }, 'loracle dawn: ask goes live');
    jobs.startAsk({ askId: ask.id, wishId: ask.wishId, userId: ask.userId });
    return true;
  }

  // ---- 1. Collect ------------------------------------------------------------

  async function collect(now: Date, result: LoracleTickResult) {
    const open = await db.select().from(loracleBatches).where(isNull(loracleBatches.endedAt)).orderBy(asc(loracleBatches.submittedAt));
    for (const b of open) {
      let status: string;
      try {
        status = (await batches!.retrieve(b.id)).processing_status;
      } catch (err) {
        log.warn({ batchId: b.id, err: err instanceof Error ? err.name : 'unknown' }, 'loracle dawn: a batch could not be read');
        continue;
      }
      const lines = new Map<string, BatchResultLine>();
      const ended = status === 'ended';
      if (ended) {
        try {
          for await (const line of await batches!.results(b.id)) lines.set(line.custom_id, line);
        } catch (err) {
          log.warn({ batchId: b.id, err: err instanceof Error ? err.name : 'unknown' }, 'loracle dawn: batch results could not be read');
          continue;
        }
      } else if (now.getTime() - b.submittedAt.getTime() < LOST_BATCH_MS) {
        continue; // still at work
      }
      // Claim it: a batch is taken once, by one process, before anything is recorded or moved.
      const [mine] = await db
        .update(loracleBatches)
        .set({ endedAt: new Date() })
        .where(and(eq(loracleBatches.id, b.id), isNull(loracleBatches.endedAt)))
        .returning({ id: loracleBatches.id });
      if (!mine) continue;
      // Ended (or lost: every request is sent again). Each item takes its own results.
      const groups = new Map<string, BatchItem[]>();
      for (const item of b.items) {
        const key = item.roadId ? `r:${item.roadId}` : `a:${item.askId}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      for (const items of groups.values()) {
        try {
          if (items[0]!.roadId) await takeRoad(b.id, items[0]!.roadId, items, lines, result);
          else if (items[0]!.askId) await takeAsk(b.id, items[0]!.askId, items, lines, result);
        } catch (err) {
          log.error({ batchId: b.id, err }, 'loracle dawn: a result could not be taken');
        }
      }
      result.collected++;
      // Read and taken: nothing of it need stay at Anthropic (only an ended batch can be deleted).
      if (ended) {
        await batches!.delete(b.id).catch((err: unknown) =>
          log.warn({ batchId: b.id, err: err instanceof Error ? err.name : 'unknown' }, 'loracle dawn: a batch could not be deleted'),
        );
      }
    }
  }

  /** A road's results from one batch. */
  async function takeRoad(batchId: string, roadId: string, items: BatchItem[], lines: Map<string, BatchResultLine>, result: LoracleTickResult) {
    const [found] = await db
      .select({ road: wishRoads, wish: wishes })
      .from(wishRoads)
      .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
      .where(eq(wishRoads.id, roadId))
      .limit(1);
    const state = found?.road.batch ?? null;
    const current =
      !!found && found.road.lane === 'dawn' && IN_PROGRESS.includes(found.road.status) && state?.pending?.batchId === batchId;
    // What was paid for is always counted (a burned scroll keeps no ids; see recordSpend).
    const spend: SpendEntry[] = [];
    for (const item of items) {
      const line = lines.get(item.customId);
      if (line?.result.type !== 'succeeded') continue;
      const msg = line.result.message;
      const stage: LoracleStage = item.part === 'ROAD' || item.part === 'KEEPERS' ? SCOUT_STAGE[item.part] : (item.part as LoracleStage);
      const outcome = item.part === 'ROAD' || item.part === 'KEEPERS' ? scoutOutcome(msg) : outcomeOf(readStructured(msg, QuestDraftWire));
      spend.push(paid(stage, msg, outcome, batchId));
    }
    // A burned wish's batch still counts toward its Lorer's hidden limit (the item keeps whose it was).
    await recordSpend(db, spend, {
      userId: found?.wish.userId ?? items[0]?.userId ?? null,
      wishId: found?.wish.id ?? null,
      day: found?.wish.day ?? items[0]?.day ?? null,
      roadId,
      lane: 'dawn',
    });
    if (!found || !state || !current) return;
    const { road, wish } = found;
    state.pending = null;
    const ctx = ctxFor(wish, wish.userId);
    const signs: LoracleSign[] = [];
    const onBlock = signer((s) => signs.push(s));
    let live: string | null = null;
    let retry = false;

    if (state.stage === 'scouts') {
      const seen = seenFrom(state.seen);
      for (const item of items) {
        const part = state.parts.find((p) => p.role === item.part);
        const line = lines.get(item.customId);
        if (!part) continue;
        if (!line || line.result.type === 'canceled' || line.result.type === 'expired') retry = true;
        else if (line.result.type === 'errored') {
          if (errorTypeOf(line) === 'invalid_request_error') live = 'invalid_request';
          else retry = true;
        } else if (takeScout(part, line.result.message, seen, onBlock) === 'refusal') live = 'refusal';
      }
      state.seen = seen.list();
    } else if (state.stage === 'draw' && state.flow && state.ledger) {
      const restored = restoreLedger(state.ledger, [], ctx.todayIso);
      const line = lines.get(items[0]!.customId);
      if (!restored) live = 'ledger';
      else if (!line || line.result.type === 'canceled' || line.result.type === 'expired') retry = true;
      else if (line.result.type === 'errored') {
        if (errorTypeOf(line) === 'invalid_request_error') live = 'invalid_request';
        else retry = true;
      } else {
        const read = readStructured(line.result.message, QuestDraftWire);
        if (read.kind === 'refusal') live = 'refusal';
        else {
          const checkCtx = {
            ledger: restored.ledger,
            weighing: wish.weighing,
            wishText: wish.text,
            homeCountry: wish.realm.country,
            todayIso: ctx.todayIso,
            seen: restored.seen,
            earlier: state.flow.task === 'again' ? await earlierRoads(db, wish.id, road.id) : undefined,
          };
          drawFeed(state.flow, read, (d) => checkDraft(d, checkCtx));
        }
      }
    }

    if (retry && !live) {
      state.tries++;
      if (state.tries >= MAX_TRIES) live = 'tries';
    } else if (!retry) state.tries = 0;
    await roadSigns(road.id, road.runId, signs);
    if (live) {
      if (await roadLive(road, wish, state, live)) result.live++;
      return;
    }
    await advanceRoad(road, wish, state, ctx, result);
  }

  /** After its results: the scouts' ledger, the next compose step, or the finished road. */
  async function advanceRoad(road: RoadRow, wish: WishRow, state: RoadDawnState, ctx: MindContext, result: LoracleTickResult) {
    const guard = and(
      eq(wishRoads.id, road.id),
      road.runId ? eq(wishRoads.runId, road.runId) : isNull(wishRoads.runId),
      inArray(wishRoads.status, [...ROAD_IN_PROGRESS]),
    );
    if (state.stage === 'scouts' && state.parts.every((p) => p.done)) {
      const dossiers = state.parts.filter((p) => !p.refused).map((p) => p.texts.join('\n')).filter((t) => t.trim());
      const seen = seenFrom(state.seen);
      const ledger = dossiers.length ? buildLedger(dossiers, seen, ctx.todayIso) : null;
      if (!ledger || ledger.notes.length < MIN_NOTES) {
        // The scouts brought back too little: the live lane tries again (with its own retry).
        if (await roadLive(road, wish, state, 'thin')) result.live++;
        return;
      }
      const signs: LoracleSign[] = [];
      if (nameKeepsComingUp(ledger.notes)) signs.push({ kind: 'name' });
      if (weighsCost(ledger.notes)) signs.push({ kind: 'cost' });
      await roadSigns(road.id, road.runId, signs, 'drawing');
      state.stage = 'draw';
      state.ledger = ledgerRecord(ledger, dossiers, seen);
      state.flow = drawFlow(road.n > 1 ? 'again' : 'quest');
      state.parts = [];
    }
    if (state.stage === 'draw' && state.flow) {
      const flow = state.flow;
      if (flow.step === 'silent') {
        await db.transaction(async (tx) => {
          const rows = await tx
            .update(wishRoads)
            .set({ status: 'silent', runId: null, batch: null, updatedAt: new Date() })
            .where(guard)
            .returning({ id: wishRoads.id });
          if (rows.length)
            await tx.update(wishes).set({ status: 'silent', updatedAt: new Date() }).where(and(eq(wishes.id, wish.id), eq(wishes.status, 'listening')));
        });
        return;
      }
      if (flow.step === 'failed') {
        if (await roadLive(road, wish, state, flow.failure ?? 'failed')) result.live++;
        return;
      }
      if (flow.step === 'done' && flow.checked && state.ledger) {
        const restored = restoreLedger(state.ledger, [], ctx.todayIso);
        if (!restored) {
          if (await roadLive(road, wish, state, 'ledger')) result.live++;
          return;
        }
        await roadSigns(road.id, road.runId, [{ kind: 'seal' }], 'sealing');
        const checked = flow.checked;
        const drawn = toRoad(checked.draft, restored.ledger, ctx.todayIso);
        const wrote = await writeRoad(db, road.id, wish.id, guard, {
          kind: 'road',
          road: drawn,
          rough: checked.hard.length > 0,
          faults: doneFaults(flow),
          forge: checked.draft.forge,
          ledger: state.ledger,
          spend: [],
        });
        // The pins are drawn by the sweep (a ready road with no run and no heartbeat).
        if (wrote) await db.update(wishRoads).set({ runId: null, heartbeatAt: null }).where(eq(wishRoads.id, road.id));
        log.info({ wishId: wish.id, roadId: road.id, rough: checked.hard.length > 0, wrote }, 'loracle dawn: road ready');
        return;
      }
    }
    await db.update(wishRoads).set({ batch: state, updatedAt: new Date() }).where(guard);
  }

  /** An ask's results from one batch. */
  async function takeAsk(batchId: string, askId: string, items: BatchItem[], lines: Map<string, BatchResultLine>, result: LoracleTickResult) {
    const [ask] = await db.select().from(wishAsks).where(eq(wishAsks.id, askId)).limit(1);
    const state = ask?.batch ?? null;
    const current = !!ask && ask.lane === 'dawn' && ask.status === 'dawn' && state?.pending?.batchId === batchId;
    const spend: SpendEntry[] = [];
    for (const item of items) {
      const line = lines.get(item.customId);
      if (line?.result.type !== 'succeeded') continue;
      const msg = line.result.message;
      const scout = item.part === 'DEEPER';
      spend.push(paid(scout ? 'deeper-scout' : 'deeper', msg, scout ? scoutOutcome(msg) : outcomeOf(readStructured(msg, DeeperWire)), batchId));
    }
    await recordSpend(db, spend, {
      userId: ask?.userId ?? items[0]?.userId ?? null,
      wishId: ask?.wishId ?? null,
      day: ask?.day ?? items[0]?.day ?? null,
      askId,
      lane: 'dawn',
    });
    if (!ask || !state || !current) return;
    state.pending = null;
    const [wish] = await db.select().from(wishes).where(eq(wishes.id, ask.wishId)).limit(1);
    if (!wish) return;
    const ctx = ctxFor(wish, ask.userId);
    const signs: LoracleSign[] = [];
    const line = lines.get(items[0]!.customId);
    let live: string | null = null;
    let retry = false;
    if (!line || line.result.type === 'canceled' || line.result.type === 'expired') retry = true;
    else if (line.result.type === 'errored') {
      if (errorTypeOf(line) === 'invalid_request_error') live = 'invalid_request';
      else retry = true;
    } else if (state.stage === 'scout' && state.part) {
      const seen = seenFrom(state.seen);
      takeScout(state.part, line.result.message, seen, signer((s) => signs.push(s)));
      state.seen = seen.list();
      // A refusing scout leaves the ledger as it was: the answer draws on what the cast found.
    } else if (state.stage === 'answer' && state.flow && state.ledger) {
      const read = readStructured(line.result.message, DeeperWire);
      if (read.kind === 'refusal') live = 'refusal';
      else {
        const restored = restoreLedger(state.ledger, [], ctx.todayIso);
        const [wp] = await db.select({ country: wishWaypoints.country }).from(wishWaypoints).where(eq(wishWaypoints.id, ask.waypointId)).limit(1);
        if (!restored) live = 'ledger';
        else
          deeperFeed(state.flow, read, (d) =>
            checkDeeper(d, {
              ledger: restored.ledger,
              seen: restored.seen,
              todayIso: ctx.todayIso,
              tags: wish.weighing.tags,
              wishText: wish.text,
              question: ask.question,
              homeCountry: wish.realm.country,
              waypointCountry: wp?.country ?? '',
            }),
          );
      }
    }
    if (retry && !live) {
      state.tries++;
      if (state.tries >= MAX_TRIES) live = 'tries';
    } else if (!retry) state.tries = 0;
    await askSigns(ask.id, signs);
    if (live) {
      if (await askLive(ask, live)) result.live++;
      return;
    }
    await advanceAsk(ask, wish, state, ctx, result);
  }

  async function advanceAsk(ask: AskRow, wish: WishRow, state: AskDawnState, ctx: MindContext, result: LoracleTickResult) {
    const guard = and(eq(wishAsks.id, ask.id), eq(wishAsks.status, 'dawn'), eq(wishAsks.lane, 'dawn'));
    if (state.stage === 'scout' && state.part?.done) {
      const roads = await db.select({ quest: wishRoads.quest }).from(wishRoads).where(eq(wishRoads.wishId, wish.id));
      const restored = restoreLedger(wish.ledger, citedSources(roads), ctx.todayIso);
      if (!restored) {
        if (await askLive(ask, 'ledger')) result.live++;
        return;
      }
      const seen = seenFrom([...(restored.seen.list()), ...state.seen]);
      const text = state.part.refused ? '' : state.part.texts.join('\n');
      const merged = text.trim() ? mergeDossier(restored.ledger, text, seen, ctx.todayIso) : { ledger: restored.ledger, added: [] };
      const signs: LoracleSign[] = [];
      if (nameKeepsComingUp(merged.added)) signs.push({ kind: 'name' });
      if (weighsCost(merged.added)) signs.push({ kind: 'cost' });
      await askSigns(ask.id, signs);
      state.stage = 'answer';
      state.dossier = text || null;
      state.ledger = ledgerRecord(merged.ledger, restored.dossiers, seen);
      state.found = merged.added;
      state.flow = deeperFlow();
      state.part = null;
    }
    if (state.stage === 'answer' && state.flow) {
      const flow = state.flow;
      if (flow.step === 'silent') {
        await db.update(wishAsks).set({ status: 'silent', batch: null, updatedAt: new Date() }).where(guard);
        return;
      }
      if (flow.step === 'failed') {
        // Safety faults that outlived the repair are never shown: the live lane answers it afresh.
        if (flow.failure === 'safety') log.error({ loracle: 'safety', askId: ask.id, faults: flow.faults }, 'loracle dawn: deeper safety faults remained');
        if (await askLive(ask, 'failed')) result.live++;
        return;
      }
      if (flow.step === 'done' && flow.checked && state.ledger) {
        const restored = restoreLedger(state.ledger, [], ctx.todayIso);
        if (!restored) {
          if (await askLive(ask, 'ledger')) result.live++;
          return;
        }
        await askSigns(ask.id, [{ kind: 'seal' }]);
        await db
          .update(wishAsks)
          .set({
            status: 'answered',
            answer: toDeeper(flow.checked.draft, restored.ledger),
            found: state.found,
            rough: flow.checked.hard.length > 0,
            faults: deeperFaults(flow),
            batch: null,
            answeredAt: new Date(),
            updatedAt: new Date(),
          })
          .where(guard);
        return;
      }
    }
    await db.update(wishAsks).set({ batch: state, updatedAt: new Date() }).where(guard);
  }

  // ---- 2. Keep promises --------------------------------------------------------

  async function keepPromises(now: Date, result: LoracleTickResult, everything = false) {
    const soon = new Date(now.getTime() + PROMISE_MS);
    const moon = await pastTheMoon(db, config);
    const roads = await db
      .select({ road: wishRoads, wish: wishes })
      .from(wishRoads)
      .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
      .where(and(eq(wishRoads.lane, 'dawn'), inArray(wishRoads.status, [...ROAD_IN_PROGRESS])));
    for (const { road, wish } of roads) {
      if (!everything && road.dueBy && road.dueBy > soon) continue;
      if (moon) {
        if (road.n === 1 && !road.batch?.begun) await toMoon(road, wish);
        continue;
      }
      if (await roadLive(road, wish, road.batch, 'promise')) result.live++;
    }
    const asks = await db.select().from(wishAsks).where(and(eq(wishAsks.lane, 'dawn'), eq(wishAsks.status, 'dawn')));
    for (const ask of asks) {
      if (!everything && ask.dueBy && ask.dueBy > soon) continue;
      if (moon) continue;
      if (await askLive(ask, 'promise')) result.live++;
    }
  }

  /** Past the owner's ceiling a cast written for dawn waits for the new moon instead (the sweep wakes it). */
  async function toMoon(road: RoadRow, wish: WishRow) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(wishes)
        .set({ status: 'moon', updatedAt: new Date() })
        .where(and(eq(wishes.id, wish.id), eq(wishes.status, 'listening')))
        .returning({ id: wishes.id });
      if (rows.length)
        await tx.update(wishRoads).set({ lane: 'now', dueBy: null, batch: null, runId: null, updatedAt: new Date() }).where(eq(wishRoads.id, road.id));
    });
  }

  // ---- 3. Submit ---------------------------------------------------------------

  /** What one dawn item has cost at batch prices: the mean of the last 30 days' items (3 at least), else a cautious guess. */
  async function dawnItemMicros(): Promise<number> {
    const item = sql`coalesce(${loracleSpend.roadId}, ${loracleSpend.askId})`;
    const result = await db.execute<{ mean: string | null; n: number }>(sql`
      select avg(cost)::text as mean, count(*)::int as n from (
        select sum(${loracleSpend.costMicros}) as cost from ${loracleSpend}
        where ${loracleSpend.lane} = 'dawn' and ${loracleSpend.createdAt} >= now() - interval '30 days' and ${item} is not null
        group by ${item}
      ) items`);
    const row = result.rows[0];
    const mean = Number(row?.mean ?? 0);
    return Number(row?.n ?? 0) >= 3 && mean > 0 ? Math.round(mean) : DAWN_ITEM_MICROS;
  }

  async function submit(now: Date, result: LoracleTickResult) {
    const moon = await pastTheMoon(db, config);
    // Only for Lorers who still let the stone read ("Stop sending wishes" fades the rest anyway).
    const roads = await db
      .select({ road: wishRoads, wish: wishes })
      .from(wishRoads)
      .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
      .where(and(eq(wishRoads.lane, 'dawn'), inArray(wishRoads.status, [...ROAD_IN_PROGRESS]), consentOf(wishes.userId)))
      .orderBy(asc(wishRoads.createdAt));
    const asks = await db
      .select()
      .from(wishAsks)
      .where(and(eq(wishAsks.lane, 'dawn'), eq(wishAsks.status, 'dawn'), consentOf(wishAsks.userId)))
      .orderBy(asc(wishAsks.createdAt));

    // Fair dawn: how many items each Lorer has begun and not finished.
    const begun = new Map<string, number>();
    const bump = (userId: string) => begun.set(userId, (begun.get(userId) ?? 0) + 1);
    for (const { road, wish } of roads) if (road.batch?.begun) bump(wish.userId);
    for (const ask of asks) if (ask.batch?.begun) bump(ask.userId);
    const full = (userId: string) => (begun.get(userId) ?? 0) >= FAIR_SHARE;
    const share = async (userId: string, dueBy: Date | null, roll: (next: Date) => Promise<unknown>) => {
      if (!full(userId)) {
        bump(userId);
        return true;
      }
      // Extras roll on to the next night: their promise moves a day.
      if (dueBy && dueBy.getTime() - now.getTime() < ROLL_MS) await roll(new Date(dueBy.getTime() + 24 * HOUR_MS));
      return false;
    };
    /** Too near its promise for a batch round trip: left for the promise keeper (extras past the fair share roll a night). */
    const late = async (userId: string, dueBy: Date | null, roll: (next: Date) => Promise<unknown>) => {
      if (!dueBy || dueBy.getTime() - now.getTime() >= LATE_MS) return false;
      if (full(userId)) await roll(new Date(dueBy.getTime() + 24 * HOUR_MS));
      return true;
    };
    // The owner's ceiling: a batch's cost is recorded only when it is collected, so what is still out
    // counts as one item each; a new item is begun only while the month holds room for it.
    const itemMicros = await dawnItemMicros();
    const inflight = roads.filter((r) => r.road.batch?.pending).length + asks.filter((a) => a.batch?.pending).length;
    let room = config.monthlyUsd * 1_000_000 - (await monthSpentMicros(db, now)) - inflight * itemMicros;

    const out: (Pending & { item: BatchItem; save: (batchId: string, ids: string[]) => Promise<void> })[] = [];

    for (const { road, wish } of roads) {
      let state = road.batch;
      if (state?.pending) continue;
      let runId = road.runId;
      if (!state?.begun) {
        if (moon) {
          if (road.n === 1) await toMoon(road, wish);
          continue;
        }
        const roll = (next: Date) => db.update(wishRoads).set({ dueBy: next }).where(eq(wishRoads.id, road.id));
        if (await late(wish.userId, road.dueBy, roll)) continue;
        // Near the ceiling: left queued; the promise keeper decides by the month's real spend.
        if (room < itemMicros) continue;
        if (!(await share(wish.userId, road.dueBy, roll))) continue;
        state = await beginRoad(road, wish);
        runId = randomUUID();
        const rows = await db
          .update(wishRoads)
          .set({ batch: state, runId, status: state.stage === 'draw' ? 'drawing' : 'searching', updatedAt: new Date() })
          .where(and(eq(wishRoads.id, road.id), eq(wishRoads.lane, 'dawn'), eq(wishRoads.status, 'queued')))
          .returning({ id: wishRoads.id });
        if (!rows.length) continue;
        room -= itemMicros;
        await roadSigns(road.id, runId, [{ kind: 'dawn' }]);
      } else {
        // Claim it: another process ticking now (a deploy's old and new instance) skips it.
        const claim = randomUUID();
        const rows = await db
          .update(wishRoads)
          .set({ runId: claim, updatedAt: new Date() })
          .where(
            and(
              eq(wishRoads.id, road.id),
              eq(wishRoads.lane, 'dawn'),
              inArray(wishRoads.status, [...ROAD_IN_PROGRESS]),
              road.runId ? eq(wishRoads.runId, road.runId) : isNull(wishRoads.runId),
            ),
          )
          .returning({ id: wishRoads.id });
        if (!rows.length) continue;
        runId = claim;
      }
      const ctx = ctxFor(wish, wish.userId, now);
      // A step whose results were taken but not carried on (a process stopped in between): finish it now.
      const settled = state.stage === 'scouts' ? state.parts.every((p) => p.done) : !!state.flow && ['done', 'silent', 'failed'].includes(state.flow.step);
      if (settled) {
        await advanceRoad({ ...road, runId }, wish, state, ctx, result);
        continue;
      }
      const reqs = await roadRequests(road, wish, state, ctx);
      const st = state;
      const rid = runId;
      for (const r of reqs.requests) {
        out.push({
          ...r,
          item: { customId: r.customId, roadId: road.id, part: r.part, userId: wish.userId, day: wish.day },
          save: async (batchId, ids) => {
            st.pending = { batchId, customIds: ids };
            // Only while it is still this run's and in progress: a road faded meanwhile stays faded.
            await db
              .update(wishRoads)
              .set({ batch: st, updatedAt: new Date() })
              .where(
                and(
                  eq(wishRoads.id, road.id),
                  eq(wishRoads.lane, 'dawn'),
                  inArray(wishRoads.status, [...ROAD_IN_PROGRESS]),
                  rid ? eq(wishRoads.runId, rid) : isNull(wishRoads.runId),
                ),
              );
          },
        });
      }
      if (reqs.signs.length) await roadSigns(road.id, rid, reqs.signs);
    }

    for (const ask of asks) {
      let state = ask.batch;
      if (state?.pending) continue;
      const [wish] = await db.select().from(wishes).where(eq(wishes.id, ask.wishId)).limit(1);
      if (!wish) continue;
      let runId = ask.runId;
      if (!state?.begun) {
        // Care comes first (an ask written before the route's own floor): never sent.
        if (ask.question && careFloor(ask.question)) {
          await db
            .update(wishAsks)
            .set({ status: 'silent', batch: null, updatedAt: new Date() })
            .where(and(eq(wishAsks.id, ask.id), eq(wishAsks.status, 'dawn')));
          continue;
        }
        if (moon) continue;
        const roll = (next: Date) => db.update(wishAsks).set({ dueBy: next }).where(eq(wishAsks.id, ask.id));
        if (await late(ask.userId, ask.dueBy, roll)) continue;
        if (room < itemMicros) continue;
        if (!(await share(ask.userId, ask.dueBy, roll))) continue;
        const first = await beginAsk(ask, wish);
        if (!first) {
          if (await askLive(ask, 'focus')) result.live++;
          continue;
        }
        runId = randomUUID();
        // Claimed by the start: another process beginning it too finds a batch already there.
        const rows = await db
          .update(wishAsks)
          .set({ batch: first, runId, updatedAt: new Date() })
          .where(and(eq(wishAsks.id, ask.id), eq(wishAsks.lane, 'dawn'), eq(wishAsks.status, 'dawn'), isNull(wishAsks.batch)))
          .returning({ id: wishAsks.id });
        if (!rows.length) continue;
        state = first;
        room -= itemMicros;
        await askSigns(ask.id, [{ kind: 'dawn' }]);
      } else {
        const claim = randomUUID();
        const rows = await db
          .update(wishAsks)
          .set({ runId: claim, updatedAt: new Date() })
          .where(
            and(
              eq(wishAsks.id, ask.id),
              eq(wishAsks.lane, 'dawn'),
              eq(wishAsks.status, 'dawn'),
              ask.runId ? eq(wishAsks.runId, ask.runId) : isNull(wishAsks.runId),
            ),
          )
          .returning({ id: wishAsks.id });
        if (!rows.length) continue;
        runId = claim;
      }
      const ctx = ctxFor(wish, ask.userId, now);
      const settled = state.stage === 'scout' ? !!state.part?.done : !!state.flow && ['done', 'silent', 'failed'].includes(state.flow.step);
      if (settled) {
        await advanceAsk(ask, wish, state, ctx, result);
        continue;
      }
      const reqs = await askRequests(ask, wish, state, ctx);
      const st = state;
      const rid = runId;
      for (const r of reqs.requests) {
        out.push({
          ...r,
          item: { customId: r.customId, askId: ask.id, part: r.part, userId: ask.userId, day: ask.day },
          save: async (batchId, ids) => {
            st.pending = { batchId, customIds: ids };
            await db
              .update(wishAsks)
              .set({ batch: st, updatedAt: new Date() })
              .where(
                and(
                  eq(wishAsks.id, ask.id),
                  eq(wishAsks.lane, 'dawn'),
                  eq(wishAsks.status, 'dawn'),
                  rid ? eq(wishAsks.runId, rid) : isNull(wishAsks.runId),
                ),
              );
          },
        });
      }
      if (reqs.signs.length) await askSigns(ask.id, reqs.signs);
    }

    // One batch per stage.
    for (const stage of ['scouts', 'draw', 'deeper-scout', 'deeper'] as const) {
      const group = out.filter((p) => p.stage === stage);
      if (!group.length) continue;
      let batchId: string;
      try {
        batchId = (await batches!.create(group.map((p) => ({ custom_id: p.customId, params: p.params })))).id;
      } catch (err) {
        const status = err instanceof APIError ? err.status : null;
        log.warn({ stage, requests: group.length, status, err: err instanceof Error ? err.name : 'unknown' }, 'loracle dawn: a batch could not be sent');
        // A request the Batches API won't take at all: those items go live (with fallbacks).
        if (status === 400) await liveFor(group.map((p) => p.item), result);
        continue;
      }
      await db.insert(loracleBatches).values({ id: batchId, stage, items: group.map((p) => p.item) });
      const byItem = new Map<string, typeof group>();
      for (const p of group) {
        const key = p.item.roadId ?? p.item.askId!;
        byItem.set(key, [...(byItem.get(key) ?? []), p]);
      }
      for (const ps of byItem.values()) await ps[0]!.save(batchId, ps.map((p) => p.customId));
      result.submitted++;
      log.info({ stage, batchId, requests: group.length }, 'loracle dawn: batch sent');
    }
  }

  async function liveFor(items: BatchItem[], result: LoracleTickResult) {
    for (const id of new Set(items.map((i) => i.roadId).filter((x): x is string => !!x))) {
      const [found] = await db.select({ road: wishRoads, wish: wishes }).from(wishRoads).innerJoin(wishes, eq(wishes.id, wishRoads.wishId)).where(eq(wishRoads.id, id));
      if (found && (await roadLive(found.road, found.wish, found.road.batch, 'invalid_request'))) result.live++;
    }
    for (const id of new Set(items.map((i) => i.askId).filter((x): x is string => !!x))) {
      const [ask] = await db.select().from(wishAsks).where(eq(wishAsks.id, id));
      if (ask && (await askLive(ask, 'invalid_request'))) result.live++;
    }
  }

  /** A road's first night: its scouts, or (for "Ask again") straight to compose from the wish's ledger. */
  async function beginRoad(road: RoadRow, wish: WishRow): Promise<RoadDawnState> {
    const ctx = ctxFor(wish, wish.userId);
    const base = { pending: null, tries: 0, begun: true };
    if (road.n > 1 && wish.ledger) {
      const roads = await db.select({ quest: wishRoads.quest }).from(wishRoads).where(eq(wishRoads.wishId, wish.id));
      const restored = restoreLedger(wish.ledger, citedSources(roads), ctx.todayIso);
      if (restored) {
        return {
          ...base,
          stage: 'draw',
          parts: [],
          seen: [],
          ledger: ledgerRecord(restored.ledger, restored.dossiers, restored.seen),
          flow: drawFlow('again'),
        };
      }
    }
    const weighed = weighedOf(wish);
    return {
      ...base,
      stage: 'scouts',
      parts: [newPart('ROAD', scoutTurn(weighed, ctx, wish.weighing, 'ROAD')), newPart('KEEPERS', scoutTurn(weighed, ctx, wish.weighing, 'KEEPERS'))],
      seen: [],
      ledger: null,
      flow: null,
    };
  }

  async function beginAsk(ask: AskRow, wish: WishRow): Promise<AskDawnState | null> {
    const focus = await deeperFocusFor(db, ask.waypointId, ask.question);
    if (!focus) return null;
    const ctx = ctxFor(wish, ask.userId);
    return {
      pending: null,
      tries: 0,
      begun: true,
      stage: 'scout',
      part: newPart('DEEPER', deeperScoutTurn(weighedOf(wish), ctx, wish.weighing, focus)),
      seen: [],
      dossier: null,
      ledger: null,
      found: [],
      flow: null,
    };
  }

  /** The requests a road sends this night (scouts not done, or its next compose step), and the signs they bring. */
  async function roadRequests(road: RoadRow, wish: WishRow, state: RoadDawnState, ctx: MindContext) {
    const requests: Pending[] = [];
    const signs: LoracleSign[] = [];
    if (state.stage === 'scouts') {
      for (const part of state.parts) {
        if (part.done) continue;
        const live = scoutParams(reqCfg, part.role, '', ctx);
        requests.push({
          stage: 'scouts',
          part: part.role,
          customId: customIdOf('r', road.id, part.role.toLowerCase()),
          params: batchParams({ ...live, messages: part.messages as typeof live.messages }),
        });
      }
    } else if (state.stage === 'draw' && state.flow && state.ledger) {
      const restored = restoreLedger(state.ledger, [], ctx.todayIso);
      if (!restored) return { requests, signs };
      const weighed = weighedOf(wish);
      const base = composeTurn(weighed, ctx, wish.weighing, restored.ledger.text);
      const input = state.flow.task === 'again' ? againTurn(base, await earlierRoads(db, wish.id, road.id)) : base;
      const req = drawRequest(state.flow, input);
      if (req) {
        if (req.sign) signs.push({ kind: req.sign });
        requests.push({
          stage: 'draw',
          part: req.stage,
          customId: customIdOf('r', road.id, req.stage),
          params: batchParams(
            composeParams(reqCfg, req.turn, ctx.anonId, {
              effort: reqCfg.effort[req.effort],
              maxTokens: req.maxTokens,
              addendum: req.addendum === 'again' ? AGAIN_ADDENDUM : null,
            }),
          ),
        });
      }
    }
    return { requests, signs };
  }

  async function askRequests(ask: AskRow, wish: WishRow, state: AskDawnState, ctx: MindContext) {
    const requests: Pending[] = [];
    const signs: LoracleSign[] = [];
    if (state.stage === 'scout' && state.part && !state.part.done) {
      const live = scoutParams(reqCfg, 'DEEPER', '', ctx);
      requests.push({
        stage: 'deeper-scout',
        part: 'DEEPER',
        customId: customIdOf('a', ask.id, 'scout'),
        params: batchParams({ ...live, messages: state.part.messages as typeof live.messages }),
      });
    } else if (state.stage === 'answer' && state.flow && state.ledger) {
      const restored = restoreLedger(state.ledger, [], ctx.todayIso);
      const focus = await deeperFocusFor(db, ask.waypointId, ask.question);
      if (!restored || !focus) return { requests, signs };
      const input = deeperTurn(composeTurn(weighedOf(wish), ctx, wish.weighing, restored.ledger.text), focus);
      const req = deeperRequest(state.flow, input);
      if (req) {
        if (req.sign) signs.push({ kind: req.sign });
        requests.push({
          stage: 'deeper',
          part: 'deeper',
          customId: customIdOf('a', ask.id, 'answer'),
          params: batchParams(deeperParams(reqCfg, req.turn, ctx.anonId, { maxTokens: req.maxTokens })),
        });
      }
    }
    return { requests, signs };
  }

  async function countWaiting(): Promise<number> {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(wishRoads)
      .where(and(eq(wishRoads.lane, 'dawn'), inArray(wishRoads.status, [...ROAD_IN_PROGRESS])));
    const [a] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(wishAsks)
      .where(and(eq(wishAsks.lane, 'dawn'), eq(wishAsks.status, 'dawn')));
    return (r?.n ?? 0) + (a?.n ?? 0);
  }

  async function tickNow(now: Date): Promise<LoracleTickResult> {
    const result: LoracleTickResult = { collected: 0, submitted: 0, live: 0, waiting: 0 };
    if (!on) {
      // The lane is off (no secret, no key): anything still written for dawn goes live now.
      if (opts.awake) await keepPromises(now, result, true);
    } else {
      await collect(now, result);
      await keepPromises(now, result);
      await submit(now, result);
    }
    result.waiting = await countWaiting();
    // Roads finished at dawn get their pins; roads and asks handed to the live lane start.
    await jobs.sweep();
    if (result.collected || result.submitted || result.live)
      log.info({ loracle: 'dawn', ...result }, 'loracle dawn: tick');
    return result;
  }

  return {
    on,
    tick(now = new Date()) {
      const run = chain.catch(() => undefined).then(() => tickNow(now));
      chain = run;
      lastTick = Date.now();
      return jobs.track(run);
    },
    tickSoon() {
      if (Date.now() - lastTick < LAZY_TICK_MS) return;
      lastTick = Date.now();
      const run = chain.catch(() => undefined).then(() => tickNow(new Date()));
      chain = run;
      jobs.track(run).catch((err: unknown) => log.warn({ err }, 'loracle dawn: lazy tick failed'));
    },
  };
}
