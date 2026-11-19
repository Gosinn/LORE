// The contracts between the Loracle's routes, its jobs and its mind. The mind is either Claude
// (the real one, needs ANTHROPIC_API_KEY) or the deterministic dev fake (LORACLE_MIND=fake).
// Routes and jobs only ever talk to a `LoracleMind`; they never import the SDK.
//
// Privacy: the mind is told the wish, the realm's label and country, how far the Lorer will go,
// what calls to them, what they told the stone about themselves, today's date and an anonymous
// id. Never a name, username, email, user id, crew, plan, chapter, calendar or coordinates.
// Nothing here is ever logged with its text (log only ids, stages, timings, tokens and cost).
import type {
  Calling,
  DeeperAnswer,
  Emblem,
  Keeper,
  LoracleContext,
  LoracleSign,
  LoracleTag,
  Mark,
  MarkStatus,
  PinPrecision,
  Provisions,
  QuestSource,
  QuestSpan,
  RoadStatus,
  RoadStep,
  WaitPhase,
  WaypointKind,
  WishFailure,
} from '#shared';
import type { DeeperFlow, DrawFlow } from './flow.ts';
import type { SeenUrl } from './ledger.ts';

export type { LoracleSign, WaitPhase } from '#shared';

// ---------------------------------------------------------------------------
// What the mind receives

/** The wish as cast. */
export interface MindWish {
  /** The wish text ("I wish to become the Lethwei champion of the world."). */
  text: string;
  /** The Lorer's answer to the stone's riddle, if this cast answers one. */
  riddleAnswer: string | null;
  /** True when this is the wish the stone offered after a reroute. */
  rerouted: boolean;
}

/** A wish the weighing sent on as a quest: what `cast` needs. */
export interface WeighedWish extends MindWish {
  weighing: Weighing;
}

/** What the mind is told about the Lorer (see the privacy note at the top). */
export interface MindContext {
  /** "Where do you stand?": the realm's label (a town) and ISO country code. Nothing finer. */
  realm: { label: string; country: string };
  /** "How far will you go?" in km. NO_LIMIT_KM (20000) means anywhere on Earth. */
  reachKm: number;
  /** "What calls to you?" Optional leanings; the wish speaks loudest. */
  callings: Calling[];
  /** "What the stone should know". `passport` null = assume the realm's country. */
  lorer: Omit<LoracleContext, 'callings'>;
  /** The Lorer's today in words, in their zone ("Wednesday 18 November 2026"). */
  today: string;
  /** The same day as YYYY-MM-DD. */
  todayIso: string;
  /** IANA zone, e.g. "Atlantic/Reykjavik". */
  timeZone: string;
  /** sha256(config.loracle.anonSalt + userId), first 32 hex chars: sent as metadata.user_id. */
  anonId: string;
}

// ---------------------------------------------------------------------------
// Weigh: the synchronous first look, inside the cast request

/** What the weighing saw in a quest-wish. Server-side only; never sent to the client. */
export interface Weighing {
  tags: LoracleTag[];
  /** The wish beneath the wish, 8 words at most. */
  desire: string;
  /** Words in the wish that set terms, copied exactly ("alone", "with my dad"). */
  binds: string[];
  /** Who goes with the Lorer and what matters for safety, or null. */
  companion: string | null;
  /** The human reason it cannot wait, or null. */
  clock: string | null;
  /** The five answers a generic assistant would give: the road must beat them. */
  obvious: string[];
  /** Proper nouns and key words to search, with spelling variants. */
  terms: string[];
  hostLanguage: string | null;
  /** First searches for the road (gates, places, a door near home this week). */
  roadPlan: string[];
  /** First searches for named people (teachers, keepers, those who chased this wish). */
  keeperPlan: string[];
}

/**
 * The weighing's verdict. Only `quest` leads to anything stored.
 * - riddle: the wish has nothing a road could reach ("be happy"): ask one question back.
 * - care: signs of self-harm: the care screen, nothing stored.
 * - reroute: a crime or harm: offer the honest wish underneath ("I wish …", ≤15 words).
 * - silent: the API refused even after the server-side fallbacks.
 */
export type WeighVerdict =
  | { route: 'quest'; weighing: Weighing }
  | { route: 'riddle'; riddle: { question: string; options: string[] } }
  | { route: 'care' }
  | { route: 'reroute'; offer: string }
  | { route: 'silent' };

export interface WeighResult {
  verdict: WeighVerdict;
  /** One row per model request made (normally one). */
  spend: SpendEntry[];
}

// ---------------------------------------------------------------------------
// Cast: the long job (scouts → ledger → compose → checks → repair), run in the background

/** Where a drafted waypoint lies. `lat`/`lon` are filled by the mind only when its notes hold them (precision `ledger`) or for open water (`sea`); the job's draw step geocodes the rest. */
export interface DraftWhere {
  place: string;
  town: string | null;
  country: string;
  /** What to geocode when there are no coordinates ("Thut Ti Lethwei Gym, Yangon, Myanmar"). */
  geoQuery: string;
  lat: number | null;
  lon: number | null;
  precision: PinPrecision | null;
}

/** One waypoint as the mind drew it, marks already computed from its notes. */
export interface DraftWaypoint {
  kind: WaypointKind;
  emblem: Emblem;
  name: string;
  when: string;
  /** 'YYYY-MM' | 'YYYY-MM-DD' | null (a trigger). */
  at: string | null;
  where: DraftWhere;
  clue: string;
  lore: boolean;
  trial: string;
  person: Keeper | null;
  earns: string | null;
  mystery: string | null;
  /** "The real road": 2–4 steps. */
  steps: RoadStep[];
  /** Ledger note ids this waypoint rests on (kept for later deeper asks; never sent to the client). */
  noteIds: string[];
}

/** The quest-level part of a road, as stored in `wish_roads.quest` (everything but the waypoints). */
export interface StoredQuest {
  title: string;
  calling: string;
  truth: string | null;
  span: QuestSpan;
  thisWeek: { text: string; mark: Mark | null; day: string | null; minutes: number };
  provisions: Provisions;
  rule: string | null;
  /** Numbered from 1; every Mark.sources number refers to one of these. URLs only from what the web tools returned. */
  sources: QuestSource[];
}

/** A drawn road: the quest plus its 3–7 waypoints, in order. */
export interface DraftRoad extends StoredQuest {
  waypoints: DraftWaypoint[];
}

/** A note in the stone's ledger: a fact it found, with its standing. */
export interface LedgerNote {
  /** "N9" */
  id: string;
  /** person | place | gate | cost | rule | event | … */
  kind: string;
  name: string | null;
  place: string | null;
  text: string;
  status: MarkStatus;
  year: string | null;
  /** Source numbers (QuestSource.n). */
  sources: number[];
}

/**
 * What the stone found, stored on `wishes.ledger` (deleted with the wish). The export includes
 * `notes` and `gaps`; `dossiers` are raw working notes and are never exported or sent to the client.
 * Since phase B the whole ledger is kept (its sources, the coordinates and spellings it settled, the
 * places that named nobody, and every URL the tools returned), so "Ask again" and deeper asks draw
 * from it without sending the scouts out again. Phase A records lack those parts.
 */
export interface LedgerRecord {
  notes: LedgerNote[];
  gaps: string[];
  dossiers?: string[];
  sources?: QuestSource[];
  coords?: Record<string, { lat: number; lon: number }>;
  aka?: Record<string, string[]>;
  noNames?: string[];
  seen?: SeenUrl[];
}

/**
 * A road already drawn, as the AGAIN addendum is told of it (its shape, keepers and trials in order,
 * so the next differs; checks.ts faults a road that repeats one).
 */
export interface EarlierRoad {
  title: string;
  calling: string;
  keepers: string[];
  /** Its waypoints in order: name and place. */
  waypoints: { name: string; place: string }[];
}

/**
 * Where `draw` starts (phase B): a ledger already found. `task` again: "Ask again" (another road, told
 * of the roads already drawn); quest: a dawn road resumed in the live lane after its scouts.
 * `sources`: every source the wish's roads cite (a phase A ledger is rebuilt from its dossiers and these).
 */
export interface DrawFrom {
  task: 'quest' | 'again';
  ledger: LedgerRecord;
  earlier: EarlierRoad[];
  sources: QuestSource[];
}

/** The waypoint a deeper ask lights, and the quest around it (no sources, no note ids). */
export interface DeeperFocus {
  /** The road as the Lorer sees it, compact: title, calling, waypoint names and places. */
  quest: { title: string; calling: string; waypoints: { position: number; name: string; place: string; when: string }[] };
  waypoint: {
    position: number;
    name: string;
    when: string;
    place: string;
    town: string | null;
    country: string;
    clue: string;
    trial: string;
    person: { name: string | null; role: string } | null;
    mystery: string | null;
    steps: string[];
  };
  question: string | null;
}

/** A deeper ask for the mind: the wish, its ledger, and the waypoint to light. */
export interface DeeperAsk {
  wish: WeighedWish;
  ledger: LedgerRecord;
  /** Every source the wish's roads cite (for a phase A ledger). */
  sources: QuestSource[];
  focus: DeeperFocus;
}

/** A deeper answer as stored on `wish_asks.answer`: marks refer to its own `sources`. */
export interface StoredDeeper {
  answer: DeeperAnswer;
  sources: QuestSource[];
}

/**
 * What a deeper ask gives back. `found`: the new notes the deeper scout brought (kept with the ask).
 * Failures are thrown as MindError, like a cast.
 */
export type DeeperDraft =
  | { kind: 'answer'; answer: StoredDeeper; found: LedgerNote[]; rough: boolean; faults: string[]; spend: SpendEntry[] }
  | { kind: 'silent'; spend: SpendEntry[] };

// ---------------------------------------------------------------------------
// The dawn lane's stored state (wish_roads.batch, wish_asks.batch): plain JSON, resumable by any
// process at any tick.

/** One scout's conversation so far: the user turn, then each paused assistant turn echoed back. */
export interface ScoutPart {
  role: 'ROAD' | 'KEEPERS' | 'DEEPER';
  /** Anthropic.Beta.BetaMessageParam[] (kept as JSON). */
  messages: unknown[];
  /** Continuations sent after pause_turn. */
  resends: number;
  /** The dossier text from every reply so far. */
  texts: string[];
  done: boolean;
  refused: boolean;
}

/** A request out in a batch: which batch, and the custom ids of this item's requests in it. */
export interface DawnPending {
  batchId: string;
  customIds: string[];
}

interface DawnCommon {
  pending: DawnPending | null;
  /** Batch failures (errored, expired, canceled) in a row for the current request; at 3 it goes live. */
  tries: number;
  /** The dawn sign was written and the item took its share of the night (fair dawn). */
  begun: boolean;
}

/** A road in the dawn lane: its scouts, then (with the ledger built) the compose/repair flow. */
export interface RoadDawnState extends DawnCommon {
  stage: 'scouts' | 'draw';
  parts: ScoutPart[];
  seen: SeenUrl[];
  /** Built once the scouts are done; the live lane resumes from it ("draw"). */
  ledger: LedgerRecord | null;
  flow: DrawFlow | null;
}

/** A deeper ask in the dawn lane: its DEEPER scout, then the answer flow. */
export interface AskDawnState extends DawnCommon {
  stage: 'scout' | 'answer';
  part: ScoutPart | null;
  seen: SeenUrl[];
  /** The deeper scout's dossier, once done. */
  dossier: string | null;
  /** The wish's ledger joined with the deeper scout's findings, once the scout is done. */
  ledger: LedgerRecord | null;
  /** The notes the deeper scout added. */
  found: LedgerNote[];
  flow: DeeperFlow | null;
}

/** One request in a loracle_batches row: whose it is. */
export interface BatchItem {
  customId: string;
  roadId?: string;
  askId?: string;
  /** ROAD | KEEPERS | DEEPER for scouts; compose | repair | again | deeper for the rest. */
  part: string;
  /**
   * Whose it is and their local day, so a batch still counts toward its Lorer's hidden limit after
   * the wish is burned (absent on items sent before this was kept).
   */
  userId?: string;
  day?: string | null;
}

/**
 * What a cast attempt gives back.
 * - road: the checked road. `rough` = hard faults remained after the one repair (for the owner's
 *   eval; never shown). `faults` are short fault codes/lines for the log (no wish text).
 *   `forge` is the mind's private working (stored on wish_roads.forge, never sent or exported).
 * - silent: the compose step was refused even after the fallbacks: the road ends `silent`.
 * Failures are thrown as `MindError` (the job retries once, then the road fades). Safety faults
 * that survive the repair and a fresh compose are thrown as MindError('error').
 */
export type CastDraft =
  | {
      kind: 'road';
      road: DraftRoad;
      rough: boolean;
      faults: string[];
      forge: unknown;
      ledger: LedgerRecord | null;
      spend: SpendEntry[];
    }
  | { kind: 'silent'; spend: SpendEntry[] };

/** Where the mind reports real events during a cast; the job retells them with `signLine`. */
export type SignSink = (sign: LoracleSign) => void;

export interface CastOptions {
  /** When the job's budget runs out (epoch ms): a larger rerun that could not finish is not started. */
  deadline?: number;
  /**
   * Told the scouts' ledger as soon as it is built, before anything is composed: an attempt cut off
   * after the scouts lets the next attempt draw from it instead of paying for the scouts again.
   */
  onLedger?: (record: LedgerRecord) => void;
}

/**
 * The stone's mind. One instance per server (AppContext.mind); undefined while asleep.
 *
 * Every call takes an AbortSignal: the cast request's (client gone) for `weigh`, the job's
 * (`AbortSignal.any([timeout, shutdown, per-wish])`) for `cast`. On abort, reject with
 * MindError('interrupted') (shutdown / burn) or MindError('timeout').
 */
export interface LoracleMind {
  /** 'claude' for the real mind; 'fake' for LORACLE_MIND=fake (no network, canned quests). */
  readonly kind: 'claude' | 'fake';
  /** The first look: decides the route. Effort low, ≤ ~10 s. Throws MindError on failure. */
  weigh(wish: MindWish, context: MindContext, signal: AbortSignal): Promise<WeighResult>;
  /**
   * Draws the road. Calls `onSign` as real things happen (searches, fetches, compose, repair,
   * seal), in order; the first sign of each phase moves the road's status. Takes ~60–150 s for
   * Claude, ~8 s for the fake.
   */
  cast(wish: WeighedWish, context: MindContext, onSign: SignSink, signal: AbortSignal, opts?: CastOptions): Promise<CastDraft>;
  /**
   * Draws a road from a ledger already found (phase B): "Ask again", or a dawn road resumed live
   * after its scouts. No scouts when the ledger can be read back (a phase A ledger that can't be
   * rebuilt sends them out again, as a cast). Compose, checks and repair as in `cast`.
   */
  draw(wish: WeighedWish, context: MindContext, from: DrawFrom, onSign: SignSink, signal: AbortSignal, opts?: CastOptions): Promise<CastDraft>;
  /** Lights one waypoint (phase B): a short DEEPER scout, then a small checked answer. */
  deeper(ask: DeeperAsk, context: MindContext, onSign: SignSink, signal: AbortSignal): Promise<DeeperDraft>;
}

/** Thrown by the mind for overloaded | timeout | error | interrupted. Its message never holds wish text. */
export class MindError extends Error {
  readonly failure: WishFailure;
  /** Requests already paid for before the failure (they still count toward the monthly ceiling). */
  readonly spend: SpendEntry[];
  /** Anthropic's request id, for the owner's log. */
  readonly requestId: string | null;

  constructor(failure: WishFailure, opts: { spend?: SpendEntry[]; requestId?: string | null; cause?: unknown } = {}) {
    super(`The Loracle's mind failed (${failure})`, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'MindError';
    this.failure = failure;
    this.spend = opts.spend ?? [];
    this.requestId = opts.requestId ?? null;
  }
}

// ---------------------------------------------------------------------------
// Spend: one row per model request (table loracle_spend). Stores no text.

/**
 * The pipeline stage a request belonged to. Phase A: weigh, road, keepers, compose, repair. Phase B:
 * again (an "Ask again" compose), deeper-scout and deeper (a deeper ask).
 */
export const LORACLE_STAGES = ['weigh', 'road', 'keepers', 'compose', 'repair', 'again', 'deeper-scout', 'deeper'] as const;
/** The stages that draw a road: every road the stone spent money on counts once toward the hidden limit. */
export const ROAD_STAGES = ['road', 'keepers', 'compose', 'repair', 'again'] as const satisfies readonly LoracleStage[];
export type LoracleStage = (typeof LORACLE_STAGES)[number];

export const SPEND_OUTCOMES = ['ok', 'refusal', 'max_tokens', 'error', 'care', 'riddle', 'reroute', 'silent'] as const;
export type SpendOutcome = (typeof SPEND_OUTCOMES)[number];

export interface SpendEntry {
  stage: LoracleStage;
  outcome: SpendOutcome;
  /** The model that served (a fallback model when one took over); 'fake' for the dev mind. */
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  searches: number;
  fetches: number;
  /** US$ × 1e6. 0 for the fake mind. */
  costMicros: number;
  requestId: string | null;
}

// ---------------------------------------------------------------------------
// Stored snapshots and the job's view of phases

/** `wishes.realm`: where the wish was cast from. No coordinates. */
export interface WishRealm {
  label: string;
  country: string;
  radiusKm: number;
}

/** The road status each ink phase sets (the job only ever moves a road forward). */
export const PHASE_STATUS: Record<WaitPhase, RoadStatus> = {
  listening: 'queued',
  searching: 'searching',
  drawing: 'drawing',
  sealing: 'sealing',
};
