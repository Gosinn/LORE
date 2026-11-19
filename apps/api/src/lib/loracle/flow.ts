// The stone's drawing, as a small machine that can stop between any two requests (phase B).
//
// A road is drawn from a ledger in a few requests: COMPOSE → CHECKS → (REPAIR → CHECKS) →
// (a fresh COMPOSE when safety faults survive) → done. A deeper answer: ANSWER → CHECKS →
// (REPAIR → CHECKS) → done, or failed when a safety fault survives the repair (never shown). The
// machine says which request comes next (`drawRequest`, `deeperRequest`) and takes each reply
// (`drawFeed`, `deeperFeed`); its state is plain JSON.
//
// The live lane runs it in a loop inside one job (lib/loracle/mind.ts). The dawn lane keeps the
// state on the road or the ask between hourly ticks and sends each request in a Message Batch
// (lib/loracle/dawn.ts). Both read the same rules here, so a road drawn at dawn is drawn exactly as
// one drawn now.
import { faultCodes, faultLines, type CheckResult, type DeeperCheck } from './checks.ts';
import type { Structured } from './client.ts';
import { deeperRepairTurn, repairTurn } from './prompts.ts';
import type { DeeperDraftT, QuestDraftT } from './schema.ts';
import type { LoracleStage, SpendOutcome } from './types.ts';

/** Output room for a compose or repair: the larger one once, after a reply was cut off. */
export const COMPOSE_TOKENS = [32_000, 64_000] as const;
/** Output room for a deeper answer. */
export const DEEPER_TOKENS = [16_000, 32_000] as const;

/** The spend outcome of a structured reply. */
export const outcomeOf = (read: Structured<unknown>): SpendOutcome =>
  read.kind === 'ok' ? 'ok' : read.kind === 'refusal' ? 'refusal' : read.kind === 'max_tokens' ? 'max_tokens' : 'error';

// ---------------------------------------------------------------------------
// A road

export interface DrawFlow {
  /**
   * compose: the first draft · repair: one repair of hard or safety faults · recompose: a fresh
   * compose when safety faults outlived the repair · done · silent (refused) · failed.
   */
  step: 'compose' | 'repair' | 'recompose' | 'done' | 'silent' | 'failed';
  task: 'quest' | 'again';
  /** Output room for the next request. */
  maxTokens: number;
  /** The latest checked draft (null when the first answer was not valid JSON for the schema). */
  checked: CheckResult | null;
  /** The first answer's text when it was not valid JSON (for the repair turn). */
  invalidText: string | null;
  /** Fault codes for the log (no text). */
  faults: string[];
  /** Why it failed: safety faults that outlived everything (the owner's log) or an error. */
  failure: 'safety' | 'error' | null;
}

export interface DrawRequest {
  /** The spend row's stage. */
  stage: Extract<LoracleStage, 'compose' | 'again' | 'repair'>;
  turn: string;
  /** Which effort setting the request uses. */
  effort: 'compose' | 'repair';
  maxTokens: number;
  /** "again": the AGAIN addendum joins the system prompt. */
  addendum: 'again' | null;
  /** The sign to show before it is sent (the first request of a step only). */
  sign: 'compose' | 'repair' | null;
}

export function drawFlow(task: 'quest' | 'again'): DrawFlow {
  return { step: 'compose', task, maxTokens: COMPOSE_TOKENS[0], checked: null, invalidText: null, faults: [], failure: null };
}

const H17_LINE = 'The answer was not valid JSON for the schema (H17). Return the whole quest as the schema asks.';

/** The next request, or null when the flow has ended. `composeInput` is the compose user turn. */
export function drawRequest(flow: DrawFlow, composeInput: string): DrawRequest | null {
  const first = flow.maxTokens === COMPOSE_TOKENS[0];
  const addendum = flow.task === 'again' ? ('again' as const) : null;
  switch (flow.step) {
    case 'compose':
      return {
        stage: flow.task === 'again' ? 'again' : 'compose',
        turn: composeInput,
        effort: 'compose',
        maxTokens: flow.maxTokens,
        addendum,
        sign: first ? 'compose' : null,
      };
    case 'repair': {
      const c = flow.checked;
      const lines = c ? faultLines([...c.safety, ...c.hard]) : [H17_LINE];
      const draftJson = c ? JSON.stringify(c.draft) : (flow.invalidText ?? '{}').slice(0, 60_000);
      return {
        stage: 'repair',
        turn: repairTurn(composeInput, draftJson, lines),
        effort: 'repair',
        maxTokens: flow.maxTokens,
        addendum,
        sign: first ? 'repair' : null,
      };
    }
    case 'recompose':
      // Counted as a repair, not a new cast.
      return { stage: 'repair', turn: composeInput, effort: 'compose', maxTokens: flow.maxTokens, addendum, sign: first ? 'repair' : null };
    default:
      return null;
  }
}

const needsRepair = (r: CheckResult | null) => !r || r.hard.length > 0 || r.safety.length > 0;

/** After a repair: safety faults earn one fresh compose; nothing checked is a failure; else done. */
function afterRepair(flow: DrawFlow) {
  if (flow.checked && flow.checked.safety.length > 0) {
    flow.faults.push('recompose', ...faultCodes(flow.checked.safety));
    flow.step = 'recompose';
  } else if (!flow.checked) {
    flow.step = 'failed';
    flow.failure = 'error';
  } else {
    flow.step = 'done';
  }
}

/** Take the reply to the request `drawRequest` gave. */
export function drawFeed(flow: DrawFlow, read: Structured<QuestDraftT>, check: (draft: QuestDraftT) => CheckResult): void {
  if (read.kind === 'max_tokens') {
    if (flow.maxTokens < COMPOSE_TOKENS[1]) flow.maxTokens = COMPOSE_TOKENS[1];
    else {
      flow.step = 'failed';
      flow.failure = 'error';
    }
    return;
  }
  flow.maxTokens = COMPOSE_TOKENS[0];
  switch (flow.step) {
    case 'compose': {
      if (read.kind === 'refusal') {
        flow.step = 'silent';
        return;
      }
      flow.checked = read.kind === 'ok' ? check(read.value) : null;
      if (read.kind === 'invalid') flow.invalidText = read.text;
      if (needsRepair(flow.checked)) {
        const c = flow.checked;
        flow.faults.push('repair', ...(c ? faultCodes([...c.safety, ...c.hard]) : ['H17 json']));
        flow.step = 'repair';
        return;
      }
      afterRepair(flow);
      return;
    }
    case 'repair': {
      if (read.kind === 'ok') {
        const again = check(read.value);
        // Keep the repair unless it made things worse on safety.
        if (!flow.checked || again.safety.length <= flow.checked.safety.length) flow.checked = again;
      } else if (read.kind === 'refusal' && !flow.checked) {
        flow.step = 'silent';
        return;
      }
      afterRepair(flow);
      return;
    }
    case 'recompose': {
      if (read.kind === 'ok') {
        const again = check(read.value);
        if (again.safety.length === 0) flow.checked = again;
      }
      if (!flow.checked) {
        flow.step = 'failed';
        flow.failure = 'error';
      } else if (flow.checked.safety.length > 0) {
        flow.step = 'failed';
        flow.failure = 'safety';
      } else {
        flow.step = 'done';
      }
      return;
    }
    default:
      return;
  }
}

/** A finished flow's fault codes for the log, with the checked draft's soft fixes and hard faults. */
export function doneFaults(flow: DrawFlow): string[] {
  const c = flow.checked;
  return c ? [...flow.faults, ...c.soft, ...faultCodes(c.hard)] : [...flow.faults];
}

// ---------------------------------------------------------------------------
// A deeper answer

export interface DeeperFlow {
  step: 'answer' | 'repair' | 'done' | 'silent' | 'failed';
  maxTokens: number;
  checked: DeeperCheck | null;
  invalidText: string | null;
  faults: string[];
  /** Why it failed: safety faults that outlived the repair (never shown; the owner's log) or an error. */
  failure?: 'safety' | 'error' | null;
}

export interface DeeperRequest {
  stage: 'deeper';
  turn: string;
  maxTokens: number;
  sign: 'compose' | 'repair' | null;
}

export function deeperFlow(): DeeperFlow {
  return { step: 'answer', maxTokens: DEEPER_TOKENS[0], checked: null, invalidText: null, faults: [], failure: null };
}

const H17_DEEPER = 'The answer was not valid JSON for the schema (H17). Return the whole answer as the schema asks.';

/** The next request, or null when the flow has ended. `input` is the deeper user turn. */
export function deeperRequest(flow: DeeperFlow, input: string): DeeperRequest | null {
  const first = flow.maxTokens === DEEPER_TOKENS[0];
  if (flow.step === 'answer') return { stage: 'deeper', turn: input, maxTokens: flow.maxTokens, sign: first ? 'compose' : null };
  if (flow.step === 'repair') {
    const c = flow.checked;
    const lines = c ? faultLines([...(c.safety ?? []), ...c.hard]) : [H17_DEEPER];
    const draftJson = c ? JSON.stringify(c.draft) : (flow.invalidText ?? '{}').slice(0, 30_000);
    return { stage: 'deeper', turn: deeperRepairTurn(input, draftJson, lines), maxTokens: flow.maxTokens, sign: first ? 'repair' : null };
  }
  return null;
}

/** Safety faults of a checked answer (older stored states may lack the list). */
const safetyOf = (c: DeeperCheck | null) => c?.safety ?? [];

/**
 * Take the reply to the request `deeperRequest` gave. Hard or safety faults earn the one repair. The
 * repair is kept unless it brings more safety faults (or as many and more hard ones); an answer that
 * still has a safety fault after it fails (never shown: the live lane retries or fades the ask).
 */
export function deeperFeed(flow: DeeperFlow, read: Structured<DeeperDraftT>, check: (draft: DeeperDraftT) => DeeperCheck): void {
  if (read.kind === 'max_tokens') {
    if (flow.maxTokens < DEEPER_TOKENS[1]) flow.maxTokens = DEEPER_TOKENS[1];
    else {
      flow.step = 'failed';
      flow.failure = 'error';
    }
    return;
  }
  flow.maxTokens = DEEPER_TOKENS[0];
  if (flow.step === 'answer') {
    if (read.kind === 'refusal') {
      flow.step = 'silent';
      return;
    }
    flow.checked = read.kind === 'ok' ? check(read.value) : null;
    if (read.kind === 'invalid') flow.invalidText = read.text;
    const c = flow.checked;
    if (!c || c.hard.length > 0 || safetyOf(c).length > 0) {
      flow.faults.push('repair', ...(c ? faultCodes([...safetyOf(c), ...c.hard]) : ['H17 json']));
      flow.step = 'repair';
      return;
    }
    flow.step = 'done';
    return;
  }
  if (flow.step === 'repair') {
    if (read.kind === 'ok') {
      const again = check(read.value);
      const before = flow.checked;
      const safer = !before || safetyOf(again).length < safetyOf(before).length;
      const asSafe = !!before && safetyOf(again).length === safetyOf(before).length && again.hard.length <= before.hard.length;
      if (safer || asSafe) flow.checked = again;
    } else if (read.kind === 'refusal' && !flow.checked) {
      flow.step = 'silent';
      return;
    }
    if (!flow.checked) {
      flow.step = 'failed';
      flow.failure = 'error';
    } else if (safetyOf(flow.checked).length > 0) {
      flow.faults.push(...faultCodes(safetyOf(flow.checked)));
      flow.step = 'failed';
      flow.failure = 'safety';
    } else {
      flow.step = 'done';
    }
  }
}

/** A finished deeper flow's fault codes for the log. */
export function deeperFaults(flow: DeeperFlow): string[] {
  const c = flow.checked;
  return c ? [...flow.faults, ...c.soft, ...faultCodes(c.hard)] : [...flow.faults];
}
