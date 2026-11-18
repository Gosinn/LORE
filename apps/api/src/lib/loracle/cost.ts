// What each request to the stone's mind cost, from the usage the API reports. Stores no text.
//
// Rates are US$ per million tokens, from the Claude API docs bundled with Claude Code 2.1.325
// (shared/models.md and shared/model-migration.md). A fallback model that served part of a request
// is priced at its own rates: `usage.iterations` is the per-attempt source of truth, and top-level
// `usage` covers only the attempt that produced the returned message.
//
// Not verified: the web search fee for the Messages API (the bundled docs state $10 per 1,000
// searches for Managed Agents) and that web fetch has no fee beyond its tokens.
import type Anthropic from '@anthropic-ai/sdk';
import type { LoracleStage, SpendEntry, SpendOutcome } from './types.ts';

interface Rates {
  in: number;
  out: number;
  write5m: number;
  write1h: number;
  read: number;
}

export const RATES: Record<string, Rates> = {
  'claude-opus-5-5': { in: 4, out: 20, write5m: 5, write1h: 8, read: 0.2 },
  'claude-opus-5': { in: 5, out: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, write5m: 6.25, write1h: 10, read: 0.5 },
};
/** An unknown model is priced at the dearest known rates, so the monthly ceiling errs on the safe side. */
const UNKNOWN: Rates = { in: 5, out: 25, write5m: 6.25, write1h: 10, read: 0.5 };

/** US$ per web search (unverified for the Messages API; see the note at the top). */
export const SEARCH_USD = 0.01;

const ratesFor = (model: string) => RATES[model] ?? UNKNOWN;

interface TokenCounts {
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
}

const usd = (r: Rates, t: TokenCounts) =>
  (t.input * r.in + t.output * r.out + t.write5m * r.write5m + t.write1h * r.write1h + t.read * r.read) / 1e6;

type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
};

function countsOf(u: UsageLike): TokenCounts {
  const write = u.cache_creation_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write;
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    // When the split is missing or doesn't add up, the remainder is priced as 5-minute writes.
    write5m: Math.max(w5m, write - w1h),
    write1h: w1h,
    read: u.cache_read_input_tokens ?? 0,
  };
}

export interface Priced {
  /** The model that produced the returned message (a fallback model when one served). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  searches: number;
  fetches: number;
  costMicros: number;
}

/**
 * Price one response. With `usage.iterations`, each iteration is priced at its own model (an
 * iteration without a model is the requested one); otherwise the top-level usage at `message.model`.
 * `batch` halves every token rate (the dawn lane, phase B).
 */
export function priceMessage(
  message: Pick<Anthropic.Beta.BetaMessage, 'model' | 'usage'>,
  requestedModel: string,
  { batch = false }: { batch?: boolean } = {},
): Priced {
  const usage = message.usage;
  const served = message.model || requestedModel;
  const iterations = usage.iterations ?? null;
  let tokenUsd = 0;
  const total: TokenCounts = { input: 0, output: 0, write5m: 0, write1h: 0, read: 0 };
  const add = (t: TokenCounts) => {
    total.input += t.input;
    total.output += t.output;
    total.write5m += t.write5m;
    total.write1h += t.write1h;
    total.read += t.read;
  };
  if (iterations && iterations.length > 0) {
    for (const it of iterations) {
      const t = countsOf(it as UsageLike);
      const model = ('model' in it && typeof it.model === 'string' && it.model) || requestedModel;
      tokenUsd += usd(ratesFor(model), t);
      add(t);
    }
  } else {
    const t = countsOf(usage);
    tokenUsd += usd(ratesFor(served), t);
    add(t);
  }
  if (batch) tokenUsd /= 2;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const fetches = usage.server_tool_use?.web_fetch_requests ?? 0;
  const dollars = tokenUsd + searches * SEARCH_USD;
  return {
    model: served,
    inputTokens: total.input,
    outputTokens: total.output,
    cacheWriteTokens: total.write5m + total.write1h,
    cacheReadTokens: total.read,
    searches,
    fetches,
    costMicros: Math.round(dollars * 1e6),
  };
}

/** One spend row for one request. */
export function spendOf(
  stage: LoracleStage,
  outcome: SpendOutcome,
  message: Pick<Anthropic.Beta.BetaMessage, 'model' | 'usage'>,
  requestedModel: string,
  ms: number,
  requestId: string | null,
): SpendEntry {
  const p = priceMessage(message, requestedModel);
  return {
    stage,
    outcome,
    model: p.model,
    ms: Math.max(0, Math.round(ms)),
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
    cacheWriteTokens: p.cacheWriteTokens,
    cacheReadTokens: p.cacheReadTokens,
    searches: p.searches,
    fetches: p.fetches,
    costMicros: p.costMicros,
    requestId,
  };
}

/** A free row for the dev fake mind (model 'fake', cost 0). */
export function fakeSpend(stage: LoracleStage, outcome: SpendOutcome, ms = 0): SpendEntry {
  return {
    stage,
    outcome,
    model: 'fake',
    ms,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    searches: 0,
    fetches: 0,
    costMicros: 0,
    requestId: null,
  };
}

export const totalMicros = (spend: readonly SpendEntry[]) => spend.reduce((s, e) => s + e.costMicros, 0);
