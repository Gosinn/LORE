// Every request the Loracle makes to Claude, and nothing else. Uses only bindings documented in the
// bundled Claude API skill or checked in node_modules/@anthropic-ai/sdk (1.10.0) typings:
// client.beta.messages.create / .stream, `betas`, `fallbacks: 'default'`, output_config.{effort,format},
// web_search_20260209 / web_fetch_20260209 (max_uses, blocked_domains, user_location,
// max_content_tokens), metadata.user_id, cache_control, typed error classes and APIError.type,
// the stream's `currentMessage` (the partial message of a stream that was cut off), and (phase B)
// client.beta.messages.batches.create / .retrieve / .results (typescript/claude-api/batches.md).
//
// Claude Opus 5.5 facts this relies on: thinking is always on (omit `thinking`; never `disabled` or a
// budget); effort is the control and its default is `medium`, so every call sets it; forced
// tool_choice is a 400, so none is sent; no assistant prefill (a repair is a fresh user turn); a
// paused turn is echoed back unchanged (append-only), with no new user turn.
//
// Never logged or thrown with the wish text or the key.
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { WishFailure } from '#shared';
import type { Effort } from '../../config.ts';
import { MIRROR_DOMAINS } from './ledger.ts';
import { COMPOSE_PROMPT, DEEPER_ADDENDUM, SCOUT_PROMPT, WEIGH_PROMPT, townOf, type ScoutRole } from './prompts.ts';
import { DEEPER_FORMAT, QUEST_FORMAT, WEIGH_FORMAT } from './schema.ts';
import type { MindContext } from './types.ts';

export type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type Message = Anthropic.Beta.BetaMessage;
export type Block = Anthropic.Beta.BetaContentBlock;

export interface Reply {
  message: Message;
  requestId: string | null;
}

export interface CallOptions {
  signal: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * The narrow surface of the SDK the mind uses. The real one wraps `client.beta.messages`; tests
 * inject a fake (no network). `stream` calls `onBlock` as each content block completes.
 */
export interface MindClient {
  create(params: Params, options: CallOptions): Promise<Reply>;
  stream(params: Params, options: CallOptions, onBlock?: (block: Block) => void): Promise<Reply>;
}

/**
 * A streamed request that was cut off after it began (an abort, a timeout, a dropped stream): what
 * had arrived still costs money, so its partial reply travels with the error to be counted. The
 * partial's output tokens and tool counts arrive only at the end of a stream, so they are estimated
 * from the blocks that did arrive (searches and fetches counted by their tool calls).
 */
export class CutOff extends Error {
  readonly reply: Reply;
  constructor(cause: unknown, reply: Reply) {
    super('A Loracle request was cut off', { cause });
    this.name = 'CutOff';
    this.reply = reply;
  }
}

/** A partial streamed message, with searches and fetches counted from its tool calls. */
export function partialReply(message: Message, requestId: string | null): Reply {
  let searches = 0;
  let fetches = 0;
  for (const b of message.content) {
    if (b.type !== 'server_tool_use') continue;
    if (b.name === 'web_search') searches++;
    else if (b.name === 'web_fetch') fetches++;
  }
  const used = message.usage?.server_tool_use;
  const usage = {
    ...message.usage,
    server_tool_use: {
      ...(used ?? {}),
      web_search_requests: Math.max(used?.web_search_requests ?? 0, searches),
      web_fetch_requests: Math.max(used?.web_fetch_requests ?? 0, fetches),
    },
  } as Message['usage'];
  return { message: { ...message, usage }, requestId };
}

/** The real client: one per server, made lazily from the key (see mind.ts). */
export function anthropicClient(apiKey: string, { timeoutMs = 300_000, maxRetries = 2 } = {}): MindClient {
  const client = new Anthropic({ apiKey, maxRetries, timeout: timeoutMs });
  const opts = (o: CallOptions) => ({
    signal: o.signal,
    ...(o.timeoutMs === undefined ? {} : { timeout: o.timeoutMs }),
    ...(o.maxRetries === undefined ? {} : { maxRetries: o.maxRetries }),
  });
  return {
    async create(params, options) {
      const message = await client.beta.messages.create(params, opts(options));
      const requestId = (message as { _request_id?: string | null })._request_id ?? null;
      return { message, requestId };
    },
    async stream(params, options, onBlock) {
      const stream = client.beta.messages.stream(params, opts(options));
      if (onBlock) stream.on('contentBlock', onBlock);
      try {
        const message = await stream.finalMessage();
        return { message, requestId: stream.request_id ?? null };
      } catch (err) {
        const partial = stream.currentMessage;
        if (partial?.usage) throw new CutOff(err, partialReply(partial, stream.request_id ?? null));
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Request shapes

/** Server-side refusal fallbacks on every live request (the "default" form needs this exact beta). */
export const LIVE = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as const;

/** System blocks; the last one carries the cache breakpoint. */
export const sys = (...texts: string[]): Anthropic.Beta.BetaTextBlockParam[] =>
  texts.map((text, i) => ({
    type: 'text' as const,
    text,
    ...(i === texts.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));

export interface RequestConfig {
  model: string;
  effort: { weigh: Effort; scout: Effort; compose: Effort; repair: Effort };
}

export function weighParams(cfg: RequestConfig, turn: string, anonId: string, maxTokens = 8_000): Params {
  return {
    ...LIVE,
    betas: [...LIVE.betas],
    model: cfg.model,
    max_tokens: maxTokens,
    system: sys(WEIGH_PROMPT),
    output_config: { effort: cfg.effort.weigh, format: WEIGH_FORMAT },
    metadata: { user_id: anonId },
    messages: [{ role: 'user', content: turn }],
  };
}

const SCOUT_BUDGET: Record<ScoutRole, { search: number; fetch: number }> = {
  ROAD: { search: 6, fetch: 3 },
  KEEPERS: { search: 6, fetch: 4 },
  // Phase B: one waypoint only, effort low.
  DEEPER: { search: 3, fetch: 1 },
};

/**
 * Where the web search is told the Lorer stands. 'full': town, country and time zone; 'no-country': the
 * country left out; 'none': no location at all. The search provider refuses some countries outright
 * ("the API rejects an unsupported code with a 400 error", web search tool docs), and the request
 * then fails before anything is searched. See `placeRefused`.
 */
export type ScoutPlace = 'full' | 'no-country' | 'none';

/** Countries the search provider refused in this process: later requests (and dawn batches) leave them out. */
const refusedCountries = new Set<string>();

/**
 * When a scout request was refused for its search location (a 400 naming user_location), the place to
 * try instead: the country left out first (and remembered), then no location; null when the error is
 * anything else or nothing is left to drop.
 */
export function placeRefused(err: unknown, place: ScoutPlace, country: string): ScoutPlace | null {
  if (!(err instanceof APIError) || err.status !== 400) return null;
  const body = (err as { error?: { error?: { message?: unknown } } }).error?.error;
  const message = typeof body?.message === 'string' ? body.message : err.message;
  if (!/user_location/i.test(message)) return null;
  // (A scout sent alongside may have been refused for the same country a moment earlier.)
  if (place === 'full' && /country/i.test(message)) {
    refusedCountries.add(country);
    return 'no-country';
  }
  return place === 'none' ? null : 'none';
}

/** For tests: forget the refused countries. */
export function forgetRefusedCountries(): void {
  refusedCountries.clear();
}

export function scoutParams(cfg: RequestConfig, role: ScoutRole, turn: string, ctx: MindContext, place: ScoutPlace = 'full'): Params {
  const budget = SCOUT_BUDGET[role];
  const country = place === 'full' && /^[A-Z]{2}$/.test(ctx.realm.country) && !refusedCountries.has(ctx.realm.country) ? ctx.realm.country : null;
  const city = townOf(ctx.realm.label);
  return {
    ...LIVE,
    betas: [...LIVE.betas],
    model: cfg.model,
    max_tokens: role === 'DEEPER' ? 16_000 : 32_000,
    system: sys(SCOUT_PROMPT),
    // Automatic caching of the growing turn across paused continuations.
    cache_control: { type: 'ephemeral' },
    output_config: { effort: role === 'DEEPER' ? 'low' : cfg.effort.scout },
    metadata: { user_id: ctx.anonId },
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: budget.search,
        ...(place === 'none'
          ? {}
          : {
              user_location: {
                type: 'approximate' as const,
                ...(city ? { city } : {}),
                ...(country ? { country } : {}),
                timezone: ctx.timeZone,
              },
            }),
        blocked_domains: [...MIRROR_DOMAINS],
      },
      {
        type: 'web_fetch_20260209',
        name: 'web_fetch',
        max_uses: budget.fetch,
        max_content_tokens: 8_000,
        blocked_domains: [...MIRROR_DOMAINS],
      },
    ],
    messages: [{ role: 'user', content: turn }],
  };
}

export function composeParams(
  cfg: RequestConfig,
  turn: string,
  anonId: string,
  { effort, maxTokens, addendum = null }: { effort: Effort; maxTokens: number; addendum?: string | null },
): Params {
  return {
    ...LIVE,
    betas: [...LIVE.betas],
    model: cfg.model,
    max_tokens: maxTokens,
    // "Ask again" (phase B) adds its task as a second static block; COMPOSE_PROMPT stays the cached prefix.
    system: addendum ? sys(COMPOSE_PROMPT, addendum) : sys(COMPOSE_PROMPT),
    output_config: { effort, format: QUEST_FORMAT },
    metadata: { user_id: anonId },
    messages: [{ role: 'user', content: turn }],
  };
}

/** A deeper ask's answer (phase B): the compose prompt with the deeper task, effort medium, no tools. */
export function deeperParams(cfg: RequestConfig, turn: string, anonId: string, { maxTokens }: { maxTokens: number }): Params {
  return {
    ...LIVE,
    betas: [...LIVE.betas],
    model: cfg.model,
    max_tokens: maxTokens,
    system: sys(COMPOSE_PROMPT, DEEPER_ADDENDUM),
    output_config: { effort: 'medium', format: DEEPER_FORMAT },
    metadata: { user_id: anonId },
    messages: [{ role: 'user', content: turn }],
  };
}

// ---------------------------------------------------------------------------
// The dawn lane (phase B): the same requests through the Message Batches API, at half the token
// price. A batch request can't set `stream`, `speed`, `fallbacks` or `max_tokens: 0` (bundled docs,
// typescript/claude-api/batches.md), so those go; without `fallbacks` the fallback beta goes too.
// Everything else (tools, structured output, caching, effort, metadata) is the same request.

/** One request in a batch (the SDK's `client.beta.messages.batches.create` request params). */
export type BatchParams = Anthropic.Beta.Messages.BatchCreateParams.Request['params'];
/** One line of a batch's results. */
export type BatchResultLine = Anthropic.Beta.Messages.BetaMessageBatchIndividualResponse;

/** A live request turned into a batch request: no betas, no fallbacks, no stream. */
export function batchParams(params: Params): BatchParams {
  const { betas: _betas, fallbacks: _fallbacks, stream: _stream, ...rest } = params as Params & { stream?: unknown };
  return rest as BatchParams;
}

/** The narrow surface of the Batches API the dawn lane uses; tests inject a fake (no network). */
export interface BatchClient {
  create(requests: { custom_id: string; params: BatchParams }[]): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ id: string; processing_status: 'in_progress' | 'canceling' | 'ended' }>;
  results(id: string): Promise<AsyncIterable<BatchResultLine>>;
  /** Delete a batch whose results were read (only an ended batch can be deleted). */
  delete(id: string): Promise<void>;
}

/**
 * The real one: `client.beta.messages.batches` (create, retrieve, results, delete), made lazily from
 * the key. A create is sent without the SDK's retries: a retry after a timeout could make a second
 * batch that is paid for and never collected; a create that fails is simply sent at the next tick.
 */
export function anthropicBatches(apiKey: string): BatchClient {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return {
    async create(requests) {
      const batch = await client.beta.messages.batches.create({ requests }, { maxRetries: 0 });
      return { id: batch.id };
    },
    async retrieve(id) {
      const batch = await client.beta.messages.batches.retrieve(id);
      return { id: batch.id, processing_status: batch.processing_status };
    },
    async results(id) {
      return client.beta.messages.batches.results(id);
    },
    async delete(id) {
      await client.beta.messages.batches.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Reading replies

/**
 * The text after the last `fallback` block (all of it when there is none). A non-streamed reply
 * omits a declined partial, so this is its whole answer. A streamed reply keeps the partial before
 * the boundary and the fallback model continues from its text: see `allText`.
 */
export function finalText(content: readonly Block[]): string {
  const last = content.findLastIndex((b) => b.type === 'fallback');
  return content
    .slice(last + 1)
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Every text block in order, across fallback boundaries (a streamed partial and its continuation). */
export function allText(content: readonly Block[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

const hasFallback = (content: readonly Block[]) => content.some((b) => b.type === 'fallback');

export type Structured<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'refusal' }
  | { kind: 'max_tokens' }
  | { kind: 'invalid'; text: string };

/**
 * refusal | max_tokens | JSON.parse + Zod. Never throws on bad output. After a fallback, the text
 * after the boundary is tried first (a non-streamed reply), then every text block joined (a streamed
 * reply, where the fallback model continued the declined model's partial).
 */
export function readStructured<S extends z.ZodType>(message: Message, schema: S): Structured<z.infer<S>> {
  if (message.stop_reason === 'refusal') return { kind: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens' };
  const read = (text: string): { value: z.infer<S> } | null => {
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      return parsed.success ? { value: parsed.data as z.infer<S> } : null;
    } catch {
      return null;
    }
  };
  const text = finalText(message.content);
  const after = read(text);
  if (after) return { kind: 'ok', value: after.value };
  if (hasFallback(message.content)) {
    const joined = allText(message.content);
    const whole = read(joined);
    if (whole) return { kind: 'ok', value: whole.value };
    return { kind: 'invalid', text: joined };
  }
  return { kind: 'invalid', text };
}

/**
 * The assistant content to echo after a pause_turn. Unchanged, unless a fallback happened mid-output:
 * then, before the LAST fallback block, thinking, redacted thinking, tool_use and any server_tool_use
 * without its result are dropped, and the fallback block stays where it is.
 */
export function echoable(content: readonly Block[]): Block[] {
  const last = content.findLastIndex((b) => b.type === 'fallback');
  if (last < 0) return [...content];
  const answered = new Set(content.flatMap((b) => ('tool_use_id' in b && typeof b.tool_use_id === 'string' ? [b.tool_use_id] : [])));
  return content.filter(
    (b, i) =>
      i >= last ||
      !(
        b.type === 'thinking' ||
        b.type === 'redacted_thinking' ||
        b.type === 'tool_use' ||
        (b.type === 'server_tool_use' && !answered.has(b.id))
      ),
  );
}

/** The most continuations sent after pause_turn (1 call + at most this many resends). */
export const MAX_RESENDS = 4;

export interface ScoutRun {
  kind: 'ok' | 'refusal';
  /** Why the last request stopped (for the owner's log when a scout brings back nothing). */
  stop: string | null;
  /** Each request's reply, in order (one spend row each). */
  replies: { reply: Reply; ms: number }[];
  /** The dossier text from every request, joined. */
  text: string;
  /** Every content block of every reply (for the URL collector). */
  blocks: Block[];
}

/**
 * Run one scout: stream, and on `pause_turn` resend the same request with the assistant content
 * appended (no new user turn), at most MAX_RESENDS times. `onBlock` sees each block as it completes;
 * `onReply` sees each request's reply as it lands (so its cost counts even if a later one fails),
 * and a request cut off part-way (`cut` true) with what had arrived. The dossier is every text
 * block, across a streamed fallback's boundary (the fallback model continues the partial's text).
 */
export async function runScout(
  client: MindClient,
  params: Params,
  onBlock: (block: Block) => void,
  options: CallOptions,
  onReply?: (reply: Reply, ms: number, cut?: boolean) => void,
): Promise<ScoutRun> {
  let messages = params.messages;
  const replies: { reply: Reply; ms: number }[] = [];
  const texts: string[] = [];
  const blocks: Block[] = [];
  let stop: string | null = null;
  for (let i = 0; ; i++) {
    const t0 = Date.now();
    let reply: Reply;
    try {
      reply = await client.stream({ ...params, messages }, options, onBlock);
    } catch (err) {
      if (err instanceof CutOff) onReply?.(err.reply, Date.now() - t0, true);
      throw err;
    }
    replies.push({ reply, ms: Date.now() - t0 });
    onReply?.(reply, Date.now() - t0);
    const msg = reply.message;
    stop = msg.stop_reason ?? null;
    blocks.push(...msg.content);
    if (msg.stop_reason === 'refusal') return { kind: 'refusal', stop, replies, text: texts.join('\n'), blocks };
    texts.push(allText(msg.content));
    if (msg.stop_reason !== 'pause_turn' || i >= MAX_RESENDS) break;
    messages = [
      ...messages,
      { role: 'assistant', content: echoable(msg.content) as Anthropic.Beta.BetaContentBlockParam[] },
    ];
  }
  return { kind: 'ok', stop, replies, text: texts.join('\n'), blocks };
}

// ---------------------------------------------------------------------------
// Errors

const isTimeoutReason = (reason: unknown) =>
  !!reason && typeof reason === 'object' && (reason as { name?: unknown }).name === 'TimeoutError';

/** Error types an error event inside a stream carries (no HTTP status there) that pass with time. */
const PASSING = new Set<string>(['overloaded_error', 'rate_limit_error', 'api_error']);

/**
 * Map a thrown error to the job's failure, with the SDK's typed classes and its documented `.type`
 * field (never message matching).
 * - abort: `timeout` when the signal's reason is a TimeoutError, else `interrupted` (shutdown, burn)
 * - APIConnectionTimeoutError → timeout
 * - RateLimitError, InternalServerError (500/503/504/529), APIConnectionError → overloaded
 * - an error event inside a stream (its status is undefined): `.type` overloaded_error,
 *   rate_limit_error or api_error → overloaded; timeout_error → timeout
 * - everything else (400, 401, 403, …) → error
 * A CutOff is judged by its cause.
 */
export function failureOf(err: unknown, signal?: AbortSignal): { failure: WishFailure; requestId: string | null } {
  if (err instanceof CutOff) {
    const inner = failureOf(err.cause, signal);
    return { failure: inner.failure, requestId: inner.requestId ?? err.reply.requestId };
  }
  const requestId = err instanceof APIError ? (err.requestID ?? null) : null;
  const aborted =
    signal?.aborted ||
    err instanceof APIUserAbortError ||
    (!!err && typeof err === 'object' && ['AbortError', 'TimeoutError'].includes(String((err as { name?: unknown }).name)));
  if (aborted) {
    const reason = signal?.aborted ? signal.reason : err;
    return { failure: isTimeoutReason(reason) ? 'timeout' : 'interrupted', requestId };
  }
  if (err instanceof APIConnectionTimeoutError) return { failure: 'timeout', requestId };
  if (err instanceof RateLimitError || err instanceof InternalServerError || err instanceof APIConnectionError)
    return { failure: 'overloaded', requestId };
  if (err instanceof APIError && err.status === 529) return { failure: 'overloaded', requestId };
  if (err instanceof APIError && err.type === 'timeout_error') return { failure: 'timeout', requestId };
  if (err instanceof APIError && err.type && PASSING.has(err.type)) return { failure: 'overloaded', requestId };
  return { failure: 'error', requestId };
}
