// The stone's mind: Claude (claude-opus-5-5) behind the `LoracleMind` contract.
//
//   weigh (sync, effort low) ──► route: care · riddle · reroute · silent · quest
//   cast:  SCOUTS (ROAD ‖ KEEPERS, effort medium, web search + fetch, pause_turn ≤ 4 resends)
//          ─► LEDGER (code) ─► COMPOSE (effort high, structured, no tools) ─► CHECKS (code)
//          ─► REPAIR (effort medium, once, only on hard or safety faults) ─► CHECKS
//          ─► (safety faults still there: one fresh compose ─► CHECKS, else the road fails)
//          ─► DRAW (code: marks, sources, pins from the ledger)
//
// Privacy: the mind is told the wish, the realm's label and country, the reach, the callings, what
// the Lorer told the stone about themselves, today and an anonymous id (metadata.user_id). Never a
// name, account, email, user id or coordinates. Logs carry stages, timings, tokens, cost and
// request ids only: never the wish, the draft or the key.
import type { LoracleConfig } from '../../config.ts';
import { CutOff, anthropicClient, composeParams, failureOf, readStructured, runScout, scoutParams, weighParams } from './client.ts';
import type { Block, MindClient, Reply } from './client.ts';
import { checkDraft, faultCodes, faultLines, type CheckResult } from './checks.ts';
import { spendOf } from './cost.ts';
import { toRoad } from './draw.ts';
import { fakeMind } from './fake.ts';
import { SeenUrls, buildLedger, ledgerRecord, nameKeepsComingUp, weighsCost } from './ledger.ts';
import { careFloor } from './care.ts';
import { composeTurn, repairTurn, scoutTurn, weighTurn, type ScoutRole } from './prompts.ts';
import { QuestDraftWire, WeighingWire, type QuestDraftT, type WeighingWireT } from './schema.ts';
import {
  MindError,
  type CastDraft,
  type CastOptions,
  type LoracleMind,
  type LoracleStage,
  type MindContext,
  type MindWish,
  type SignSink,
  type SpendEntry,
  type SpendOutcome,
  type WeighResult,
  type WeighVerdict,
  type WeighedWish,
  type Weighing,
} from './types.ts';

/** Fewer notes than this and the scouts found nothing to draw from: the road fails (and is retried). */
export const MIN_NOTES = 3;

/** A compose or repair asked for the larger output room needs at least this long before the job's end. */
export const RERUN_NEEDS_MS = 120_000;

/** A logger like Fastify's (pino). Only ids, stages, timings, tokens and cost are ever passed. */
export interface MindLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const silentLog: MindLog = { info() {}, warn() {}, error() {} };

export interface ClaudeMindOptions {
  /** Inject a client (tests); otherwise one Anthropic client is made lazily from config.apiKey. */
  client?: MindClient;
  log?: MindLog;
}

/** The mind for this server: Claude when awake, the dev fake when LORACLE_MIND=fake, none while asleep. */
export function mindFor(config: LoracleConfig, opts: ClaudeMindOptions = {}): LoracleMind | undefined {
  if (config.mode === 'fake') return fakeMind();
  if (config.mode === 'awake') return claudeMind(config, opts);
  return undefined;
}

/** Turn the weighing's wire answer into a verdict, with code's own guards on top. */
export function verdictOf(w: WeighingWireT, wish: MindWish, ctx: MindContext): WeighVerdict {
  if (w.route === 'care') return { route: 'care' };
  // An offer the stone made, taken up and still weighed as harm, is never drawn: silence, not a quest.
  if (w.route === 'reroute' && wish.rerouted) return { route: 'silent' };
  if (w.route === 'reroute') {
    const offer = w.offer?.trim().replace(/\s+/g, ' ') ?? '';
    if (!/^i wish\b/i.test(offer) || careFloor(offer)) return { route: 'silent' };
    return { route: 'reroute', offer: offer.split(' ').slice(0, 15).join(' ') };
  }
  if (w.route === 'riddle' && !wish.riddleAnswer && w.riddle) {
    const options = w.riddle.options
      .map((o) => o.trim().replace(/[.!]+$/, ''))
      .filter(Boolean)
      .map((o) => o.split(/\s+/).slice(0, 5).join(' '))
      .slice(0, 3);
    if (w.riddle.question.trim() && options.length >= 2) return { route: 'riddle', riddle: { question: w.riddle.question.trim(), options } };
  }
  const tags = new Set(w.tags);
  if (ctx.lorer.age === '13-17') tags.add('youth');
  if (tags.has('lethal')) tags.add('dangerous');
  if (tags.size === 0) tags.add('open');
  const weighing: Weighing = {
    tags: [...tags],
    desire: w.desire,
    binds: w.binds,
    companion: w.companion,
    clock: w.clock,
    obvious: w.obvious,
    terms: w.terms,
    hostLanguage: w.hostLanguage,
    roadPlan: w.roadPlan.slice(0, 6),
    keeperPlan: w.keeperPlan.slice(0, 6),
  };
  return { route: 'quest', weighing };
}

/** The real mind. */
export function claudeMind(config: LoracleConfig, opts: ClaudeMindOptions = {}): LoracleMind {
  const log = opts.log ?? silentLog;
  let client = opts.client ?? null;
  const getClient = (spend: SpendEntry[]): MindClient => {
    if (client) return client;
    const key = config.apiKey;
    if (!key) throw new MindError('error', { spend });
    client = anthropicClient(key);
    return client;
  };
  const cfg = { model: config.model, effort: config.effort };

  /** One spend row (and one log line, no text) per request. */
  const account = (spend: SpendEntry[], stage: LoracleStage, outcome: SpendOutcome, reply: Reply, ms: number) => {
    const row = spendOf(stage, outcome, reply.message, cfg.model, ms, reply.requestId);
    spend.push(row);
    log.info(
      { loracle: stage, outcome, model: row.model, ms: row.ms, inTok: row.inputTokens, outTok: row.outputTokens, cacheRead: row.cacheReadTokens, searches: row.searches, fetches: row.fetches, costMicros: row.costMicros, requestId: row.requestId },
      'loracle request',
    );
  };

  const fail = (err: unknown, spend: SpendEntry[], signal: AbortSignal): MindError => {
    if (err instanceof MindError) return err.spend === spend ? err : new MindError(err.failure, { spend, requestId: err.requestId, cause: err });
    const { failure, requestId } = failureOf(err, signal);
    const status = (err as { status?: unknown })?.status;
    log[failure === 'error' ? 'error' : 'warn']({ loracle: 'failure', failure, requestId, status: typeof status === 'number' ? status : null }, 'loracle request failed');
    return new MindError(failure, { spend, requestId, cause: err });
  };

  return {
    kind: 'claude',

    async weigh(wish, ctx, signal): Promise<WeighResult> {
      if (careFloor(wish.text) || (wish.riddleAnswer && careFloor(wish.riddleAnswer))) return { verdict: { route: 'care' }, spend: [] };
      const spend: SpendEntry[] = [];
      try {
        const c = getClient(spend);
        const turn = weighTurn(wish, ctx);
        for (const maxTokens of [8_000, 16_000]) {
          signal.throwIfAborted();
          const t0 = Date.now();
          const reply = await c.create(weighParams(cfg, turn, ctx.anonId, maxTokens), { signal, timeoutMs: 90_000, maxRetries: 1 });
          const read = readStructured(reply.message, WeighingWire);
          if (read.kind === 'max_tokens') {
            account(spend, 'weigh', 'max_tokens', reply, Date.now() - t0);
            continue;
          }
          if (read.kind === 'refusal') {
            account(spend, 'weigh', 'refusal', reply, Date.now() - t0);
            return { verdict: { route: 'silent' }, spend };
          }
          if (read.kind === 'invalid') {
            account(spend, 'weigh', 'error', reply, Date.now() - t0);
            throw new MindError('error', { spend, requestId: reply.requestId });
          }
          const verdict = verdictOf(read.value, wish, ctx);
          const outcome: SpendOutcome =
            verdict.route === 'quest' ? 'ok' : verdict.route === 'riddle' ? 'riddle' : verdict.route === 'care' ? 'care' : verdict.route === 'reroute' ? 'reroute' : 'silent';
          account(spend, 'weigh', outcome, reply, Date.now() - t0);
          return { verdict, spend };
        }
        throw new MindError('error', { spend });
      } catch (err) {
        throw fail(err, spend, signal);
      }
    },

    async cast(wish: WeighedWish, ctx: MindContext, sink: SignSink, signal: AbortSignal, opts: CastOptions = {}): Promise<CastDraft> {
      const spend: SpendEntry[] = [];
      const { deadline } = opts;
      // A sign is a courtesy to the waiting Lorer: a failing sink never breaks the road.
      const onSign: SignSink = (sign) => {
        try {
          sink(sign);
        } catch (err) {
          log.warn({ loracle: 'sign', kind: sign.kind, error: err instanceof Error ? err.name : 'unknown' }, 'loracle sign sink failed');
        }
      };
      try {
        const c = getClient(spend);
        signal.throwIfAborted();

        // ---- Scouts, in parallel. Signs as real searches and fetches happen.
        const seen = new SeenUrls();
        const signed = new Set<string>();
        const queries = new Set<string>();
        const onBlock = (b: Block) => {
          if (b.type !== 'server_tool_use' || signed.has(b.id)) return;
          signed.add(b.id);
          const input = b.input as { query?: unknown; url?: unknown };
          if (b.name === 'web_search' && typeof input.query === 'string') {
            const q = input.query.trim().toLowerCase();
            if (q && !queries.has(q)) {
              queries.add(q);
              onSign({ kind: 'search', query: input.query });
            }
          } else if (b.name === 'web_fetch' && typeof input.url === 'string') {
            try {
              onSign({ kind: 'fetch', host: new URL(input.url).hostname });
            } catch {
              /* not a URL: no sign */
            }
          }
        };
        const roles: ScoutRole[] = ['ROAD', 'KEEPERS'];
        const runs = await Promise.allSettled(
          roles.map((role) =>
            runScout(c, scoutParams(cfg, role, scoutTurn(wish, ctx, wish.weighing, role), ctx), onBlock, { signal }, (reply, ms, cut) => {
              const stop = reply.message.stop_reason;
              const outcome: SpendOutcome = cut ? 'error' : stop === 'refusal' ? 'refusal' : stop === 'max_tokens' ? 'max_tokens' : 'ok';
              account(spend, role === 'ROAD' ? 'road' : 'keepers', outcome, reply, ms);
            }),
          ),
        );
        const dossiers: string[] = [];
        let refusals = 0;
        let firstError: unknown = null;
        for (const [i, r] of runs.entries()) {
          if (r.status === 'rejected') {
            firstError ??= r.reason;
            continue;
          }
          const run = r.value;
          for (const b of run.blocks) {
            onBlock(b);
            seen.collect(b);
          }
          if (run.kind === 'refusal') refusals++;
          else if (run.text.trim()) dossiers.push(run.text);
          // A scout that wrote no dossier (its notes stayed in thinking, or its resends ran out).
          else log.warn({ loracle: 'scout', role: roles[i], stop: run.stop, requests: run.replies.length }, 'loracle scout brought back nothing');
        }
        signal.throwIfAborted();
        if (dossiers.length === 0) {
          if (refusals === roles.length) return { kind: 'silent', spend };
          throw firstError ?? new MindError('error', { spend });
        }

        // ---- Ledger (code).
        const ledger = buildLedger(dossiers, seen, ctx.todayIso);
        if (nameKeepsComingUp(ledger.notes)) onSign({ kind: 'name' });
        if (weighsCost(ledger.notes)) onSign({ kind: 'cost' });
        log.info({ loracle: 'ledger', notes: ledger.notes.length, sources: ledger.sources.length, gaps: ledger.gaps.length, seen: seen.size }, 'loracle ledger');
        if (ledger.notes.length < MIN_NOTES) throw new MindError('error', { spend });

        // ---- Compose, check, repair.
        const checkCtx = { ledger, weighing: wish.weighing, wishText: wish.text, homeCountry: ctx.realm.country, todayIso: ctx.todayIso, seen };
        const composeInput = composeTurn(wish, ctx, wish.weighing, ledger.text);

        const draw = async (
          stage: 'compose' | 'repair',
          turn: string,
          effort: typeof cfg.effort.compose,
        ): Promise<{ kind: 'ok'; draft: QuestDraftT } | { kind: 'refusal' } | { kind: 'invalid'; text: string }> => {
          for (const maxTokens of [32_000, 64_000]) {
            signal.throwIfAborted();
            // The larger rerun would outlast the job: stop here rather than pay for a cut-off reply.
            if (maxTokens > 32_000 && deadline !== undefined && deadline - Date.now() < RERUN_NEEDS_MS) {
              throw new MindError('timeout', { spend });
            }
            const t0 = Date.now();
            let reply: Reply;
            try {
              reply = await c.stream(composeParams(cfg, turn, ctx.anonId, { effort, maxTokens }), { signal });
            } catch (err) {
              if (err instanceof CutOff) account(spend, stage, 'error', err.reply, Date.now() - t0);
              throw err;
            }
            const read = readStructured(reply.message, QuestDraftWire);
            const ms = Date.now() - t0;
            if (read.kind === 'max_tokens') {
              account(spend, stage, 'max_tokens', reply, ms);
              continue;
            }
            if (read.kind === 'refusal') {
              account(spend, stage, 'refusal', reply, ms);
              return { kind: 'refusal' };
            }
            if (read.kind === 'invalid') {
              account(spend, stage, 'error', reply, ms);
              return { kind: 'invalid', text: read.text };
            }
            account(spend, stage, 'ok', reply, ms);
            return { kind: 'ok', draft: read.value };
          }
          throw new MindError('error', { spend });
        };

        onSign({ kind: 'compose' });
        const first = await draw('compose', composeInput, cfg.effort.compose);
        if (first.kind === 'refusal') return { kind: 'silent', spend };
        let checked: CheckResult | null = first.kind === 'ok' ? checkDraft(first.draft, checkCtx) : null;
        const faults: string[] = [];
        const needsRepair = (r: CheckResult | null) => !r || r.hard.length > 0 || r.safety.length > 0;

        if (needsRepair(checked)) {
          onSign({ kind: 'repair' });
          const lines = checked
            ? faultLines([...checked.safety, ...checked.hard])
            : ['The answer was not valid JSON for the schema (H17). Return the whole quest as the schema asks.'];
          const draftJson = checked ? JSON.stringify(checked.draft) : first.kind === 'invalid' ? first.text.slice(0, 60_000) : '{}';
          faults.push('repair', ...(checked ? faultCodes([...checked.safety, ...checked.hard]) : ['H17 json']));
          const repaired = await draw('repair', repairTurn(composeInput, draftJson, lines), cfg.effort.repair);
          if (repaired.kind === 'ok') {
            const again = checkDraft(repaired.draft, checkCtx);
            // Keep the repair unless it made things worse on safety.
            if (!checked || again.safety.length <= checked.safety.length) checked = again;
          } else if (repaired.kind === 'refusal' && !checked) {
            return { kind: 'silent', spend };
          }
        }

        if (checked && checked.safety.length > 0) {
          // Safety still broken: one fresh compose from scratch (counted as a repair, not a new cast).
          faults.push('recompose', ...faultCodes(checked.safety));
          onSign({ kind: 'repair' });
          const fresh = await draw('repair', composeInput, cfg.effort.compose);
          if (fresh.kind === 'ok') {
            const again = checkDraft(fresh.draft, checkCtx);
            if (again.safety.length === 0) checked = again;
          }
          if (checked.safety.length > 0) {
            log.error({ loracle: 'safety', faults: faultCodes(checked.safety) }, 'loracle safety faults remained');
            throw new MindError('error', { spend });
          }
        }
        if (!checked) throw new MindError('error', { spend });

        // ---- Seal and draw.
        onSign({ kind: 'seal' });
        const road = toRoad(checked.draft, ledger, ctx.todayIso);
        const rough = checked.hard.length > 0;
        faults.push(...checked.soft, ...faultCodes(checked.hard));
        log.info({ loracle: 'road', rough, waypoints: road.waypoints.length, faults: faults.length, soft: checked.soft.length, hard: checked.hard.length }, 'loracle road');
        return {
          kind: 'road',
          road,
          rough,
          faults,
          forge: checked.draft.forge,
          ledger: ledgerRecord(ledger, dossiers),
          spend,
        };
      } catch (err) {
        throw fail(err, spend, signal);
      }
    },
  };
}

