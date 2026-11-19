// Fixtures for the Loracle's phase B and C tests: a scripted mind and a fake Message Batches client
// (never the network, never Claude), and a small made-up world that passes the checks.
import type Anthropic from '@anthropic-ai/sdk';
import type { LoracleSign, Mark } from '#shared';
import type { BatchClient, BatchParams, BatchResultLine } from '../src/lib/loracle/client.ts';
import { COMPOSE_PROMPT, DEEPER_ADDENDUM, SCOUT_PROMPT } from '../src/lib/loracle/prompts.ts';
import {
  MindError,
  type CastDraft,
  type DeeperAsk,
  type DeeperDraft,
  type DraftRoad,
  type DraftWaypoint,
  type DrawFrom,
  type LoracleMind,
  type MindContext,
  type MindWish,
  type SignSink,
  type SpendEntry,
  type WeighedWish,
  type Weighing,
  type WeighResult,
} from '../src/lib/loracle/types.ts';

type Message = Anthropic.Beta.BetaMessage;

export const spend = (stage: SpendEntry['stage'], outcome: SpendEntry['outcome'] = 'ok', costMicros = 1000): SpendEntry => ({
  stage,
  outcome,
  model: 'test',
  ms: 5,
  inputTokens: 10,
  outputTokens: 10,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  searches: 0,
  fetches: 0,
  costMicros,
  requestId: null,
});

// ---------------------------------------------------------------------------
// A small made-up world (a rescue team in Reykjavík) that the real checks pass

export const STORM_WISH = 'I wish to have friends who would drive into a storm for me.';

export const STORM_WEIGHING: Weighing = {
  tags: ['open', 'tender'],
  desire: 'friends who show up',
  binds: [],
  companion: null,
  clock: null,
  obvious: ['join a club', 'volunteer', 'take up a hobby', 'travel somewhere', 'therapy or self-help'],
  terms: ['rescue team', 'björgunarsveit'],
  hostLanguage: null,
  roadPlan: ['rescue team recruits Reykjavík 2026'],
  keeperPlan: ['rescue team recruit leader Reykjavík'],
};

export function msg(content: unknown[], stop = 'end_turn', usage: Record<string, unknown> = {}): Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      iterations: null,
      service_tier: 'batch',
      ...usage,
    },
  } as unknown as Message;
}
const text = (t: string) => ({ type: 'text', text: t, citations: null });
export const json = (v: unknown) => msg([{ type: 'thinking', thinking: '', signature: 'sig' }, text(JSON.stringify(v))]);

const searchResult = (id: string, urls: string[]) => ({
  type: 'web_search_tool_result',
  tool_use_id: id,
  content: urls.map((url) => ({ type: 'web_search_result', url, title: url, page_age: null, encrypted_content: 'x' })),
});

const ROAD_DOSSIER = `ROLE: ROAD
R1 | near | Storm Harbour Rescue Team | Reykjavík, Iceland | 64.15,-21.95 | Volunteer rescue team; recruit intake each autumn; open evening Wednesday 20:00 | VERIFIED | https://stormharbour.is/recruits | 2026-09-01
R2 | gate | Recruit year | Storm Harbour Rescue Team, Reykjavík, Iceland | - | Recruits train 18 months before full membership; minimum age 18 | VERIFIED | https://stormharbour.is/recruits | 2026-09-01
R3 | place | Hvalfjörður training ground | Hvalfjörður, Iceland | - | Winter search drills held each February | REPORTED | https://example-news.is/drills | 2026-02-10
R4 | place | Landsbjörg Rescue School | Reykjavík, Iceland | - | Runs the national first-aid course for rescue recruits, 40 hours | VERIFIED | https://rescueschool.is/courses | 2026-08-01
GAPS: Which night will the team call its recruits out first?`;

const KEEPERS_DOSSIER = `ROLE: KEEPERS
K1 | person | Sigrún Hafsteinsdóttir | Storm Harbour Rescue Team, Reykjavík, Iceland | - | Recruit leader who takes in the new recruits each autumn | VERIFIED | https://stormharbour.is/team | 2026-09-01
K2 | person | Kári Jónsson | Landsbjörg Rescue School, Reykjavík, Iceland | - | Lead first-aid instructor | VERIFIED | https://rescueschool.is/team | 2026-08-01
K3 | detail | Orange hall | Storm Harbour Rescue Team, Reykjavík, Iceland | - | The team's hall has orange boats stacked by the door | VERIFIED | https://stormharbour.is/team | 2026-09-01`;

const DEEPER_DOSSIER = `ROLE: DEEPER
D1 | event | Night search | Storm Harbour Rescue Team, Reykjavík, Iceland | - | Recruits join their first night search in the first winter | VERIFIED | https://stormharbour.is/winter | 2026-10-01
GAPS: Who leads the first night search?`;

export const roadReply = msg(
  [
    { type: 'server_tool_use', id: 'srv_r1', name: 'web_search', input: { query: 'Storm Harbour rescue recruits 2026' } },
    searchResult('srv_r1', ['https://stormharbour.is/recruits', 'https://example-news.is/drills']),
    { type: 'server_tool_use', id: 'srv_r2', name: 'web_fetch', input: { url: 'https://rescueschool.is/courses' } },
    {
      type: 'web_fetch_tool_result',
      tool_use_id: 'srv_r2',
      content: {
        type: 'web_fetch_result',
        url: 'https://rescueschool.is/courses',
        retrieved_at: '2026-11-18',
        content: { type: 'document', title: 'Courses', source: { type: 'text', media_type: 'text/plain', data: 'x' }, citations: null },
      },
    },
    text(ROAD_DOSSIER),
  ],
  'end_turn',
  { server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } },
);

export const keepersReply = msg(
  [
    { type: 'server_tool_use', id: 'srv_k1', name: 'web_search', input: { query: 'Storm Harbour team recruit leader' } },
    searchResult('srv_k1', ['https://stormharbour.is/team', 'https://rescueschool.is/team']),
    text(KEEPERS_DOSSIER),
  ],
  'end_turn',
  { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
);

/** A scout turn the server paused (pause_turn) after one search: no dossier yet; the next send goes on. */
export const pausedReply = msg(
  [
    { type: 'server_tool_use', id: 'srv_p1', name: 'web_search', input: { query: 'Storm Harbour rescue team recruits' } },
    searchResult('srv_p1', ['https://stormharbour.is/recruits']),
  ],
  'pause_turn',
  { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
);

export const deeperScoutReply = msg(
  [
    { type: 'server_tool_use', id: 'srv_d1', name: 'web_search', input: { query: 'Storm Harbour first night search recruits' } },
    searchResult('srv_d1', ['https://stormharbour.is/winter']),
    text(DEEPER_DOSSIER),
  ],
  'end_turn',
  { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
);

/** A quest draft that passes every check against the ledger the dossiers above settle into. */
export function goodDraft(title = 'The Orange Boats') {
  return {
    forge: {
      candidates: ['A journey to the recruit leader', 'The hall with orange boats', 'A night search in winter'],
      chosen: 'The team that goes out into storms.',
      versusObvious: [
        { position: 0, matches: 'volunteer', edge: 'Sigrún must take you into the intake' },
        { position: 1, matches: null, edge: null },
        { position: 2, matches: null, edge: null },
      ],
      dropped: [],
    },
    title,
    calling:
      'Real friends drive into the storm for you. Walk into the Storm Harbour hall, find Sigrún Hafsteinsdóttir, and do not quit until the team calls you one of its own.',
    truth: 'Real friends drive into the storm for you.',
    span: { amount: 2, unit: 'years' },
    map: [
      {
        kind: 'door',
        emblem: 'door',
        name: 'The Open Evening',
        when: 'Wednesday at 20:00',
        at: null,
        where: { place: 'Storm Harbour Rescue Team', town: 'Reykjavík', country: 'Iceland', geoQuery: 'Storm Harbour Rescue Team, Reykjavík, Iceland', lat: 64.15, lon: -21.95 },
        clue: 'Orange boats stacked by the door.',
        lore: false,
        trial: 'Come to the open evening and ask Sigrún Hafsteinsdóttir for a place in the autumn intake. Done when she writes your name down.',
        person: { name: 'Sigrún Hafsteinsdóttir', role: 'recruit leader', verb: 'take you in as a recruit', noteId: 'N5' },
        earns: 'Your name on the recruit list',
        mystery: null,
        road: [
          { kind: 'do', text: 'The open evening starts Wednesday at 20:00.', noteIds: ['N1'] },
          { kind: 'gate', text: 'Recruits must be 18 and train 18 months first.', noteIds: ['N2'] },
        ],
        noteIds: ['N1', 'N2', 'N5', 'N7'],
      },
      {
        kind: 'bridge',
        emblem: 'book',
        name: 'The Floor of Forty Hours',
        when: 'January 2027',
        at: '2027-01',
        where: { place: 'Landsbjörg Rescue School', town: 'Reykjavík', country: 'Iceland', geoQuery: 'Landsbjörg Rescue School, Reykjavík, Iceland', lat: null, lon: null },
        clue: 'A dummy on the floor that never wakes.',
        lore: false,
        trial: 'Pass the first-aid course until Kári Jónsson signs your card.',
        person: { name: 'Kári Jónsson', role: 'lead first-aid instructor', verb: 'sign your card', noteId: 'N6' },
        earns: 'A first-aid card',
        mystery: 'Which recruit will stand beside you on the floor.',
        road: [
          { kind: 'do', text: 'Sign up for the national first-aid course for recruits.', noteIds: ['N4'] },
          { kind: 'cost', text: 'The course runs 40 hours over winter evenings.', noteIds: ['N4'] },
        ],
        noteIds: ['N4', 'N6'],
      },
      {
        kind: 'summit',
        emblem: 'wave',
        name: 'The First Storm',
        when: 'February 2027',
        at: '2027-02',
        where: { place: 'Hvalfjörður training ground', town: 'Hvalfjörður', country: 'Iceland', geoQuery: 'Hvalfjörður, Iceland', lat: null, lon: null },
        clue: 'Wind off the fjord, and torches in a line.',
        lore: true,
        trial: 'Search the dark with the team until the leader calls you a rescuer.',
        person: null,
        earns: 'The team’s orange jacket',
        mystery: 'What the first real call-out will ask of you.',
        road: [
          { kind: 'do', text: 'Train at the February search drills in Hvalfjörður.', noteIds: ['N3'] },
          { kind: 'gate', text: 'Full membership comes after 18 months of training.', noteIds: ['N2'] },
        ],
        noteIds: ['N3', 'N2'],
      },
    ],
    thisWeek: {
      text: 'Write to Storm Harbour Rescue Team and ask Sigrún Hafsteinsdóttir about the open evening.',
      noteIds: ['N1', 'N5'],
      day: null,
      minutes: 15,
    },
    provisions: {
      coin: [],
      papers: [],
      body: [{ text: 'Recruits must be fit enough for night searches in winter.', noteIds: ['N2'], counsel: false }],
      skills: [{ text: 'Finish the 40 hours of first aid before February.', noteIds: ['N4'], counsel: false }],
      tongue: [],
    },
    rule: null,
  };
}

/** A deeper answer that passes its checks (the deeper scout's note is N8). */
export function goodAnswer(question: string | null) {
  return {
    answer: question ? 'No. Sigrún Hafsteinsdóttir takes in new recruits each autumn, whoever walks in.' : null,
    clue: 'Orange boats stacked by the door.',
    steps: [
      { kind: 'do', text: 'Walk into the Storm Harbour hall on the open evening.', noteIds: ['N1'] },
      { kind: 'do', text: 'Ask Sigrún Hafsteinsdóttir for a place in the intake.', noteIds: ['N5'] },
      { kind: 'do', text: 'Ask when the recruits join their first night search.', noteIds: ['N8'] },
    ],
    keeper: { name: 'Sigrún Hafsteinsdóttir', role: 'recruit leader', verb: 'take you in as a recruit', noteId: 'N5' },
    words: 'I came to train with the team, not to watch.',
    unknown: 'Which night the team first calls its recruits out.',
  };
}

// ---------------------------------------------------------------------------
// A fake Message Batches client

type Failure = 'api_error' | 'invalid_request_error' | 'expired' | 'refusal';

/** Which live request a batch request is: by its system prompt and its turn. */
export function partOf(params: BatchParams): 'road' | 'keepers' | 'deeper-scout' | 'compose' | 'deeper' {
  const system = Array.isArray(params.system) ? params.system : [];
  const first = system[0]?.text;
  const m0 = params.messages[0]?.content;
  const turn = typeof m0 === 'string' ? m0 : '';
  if (first === SCOUT_PROMPT) return turn.includes('ROLE: ROAD') ? 'road' : turn.includes('ROLE: KEEPERS') ? 'keepers' : 'deeper-scout';
  if (first === COMPOSE_PROMPT) return system[1]?.text === DEEPER_ADDENDUM ? 'deeper' : 'compose';
  throw new Error('unknown batch request');
}

export class FakeBatches implements BatchClient {
  created: { id: string; requests: { custom_id: string; params: BatchParams }[] }[] = [];
  private status = new Map<string, 'in_progress' | 'ended'>();
  /** While true, new batches stay in progress. */
  hold = false;
  /** The next request of a part fails this way (once each). */
  failNext: Partial<Record<ReturnType<typeof partOf>, Failure>> = {};
  /** The next first send of a scout part is paused by the server (pause_turn), once each. */
  pauseNext: Partial<Record<'road' | 'keepers' | 'deeper-scout', true>> = {};
  /** What a compose request answers (a draft JSON). */
  composeTitle = 'The Orange Boats';
  retrieved = 0;
  /** Batches deleted after their results were read. */
  deleted: string[] = [];
  /** Runs inside the next create() (once), before the batch exists: a race with the server. */
  beforeCreate: (() => Promise<void>) | null = null;

  async create(requests: { custom_id: string; params: BatchParams }[]) {
    const hook = this.beforeCreate;
    this.beforeCreate = null;
    if (hook) await hook();
    const id = `msgbatch_${this.created.length + 1}`;
    // What a live request has, a batch request must not: no betas, no fallbacks, no stream.
    for (const r of requests) {
      const p = r.params as unknown as Record<string, unknown>;
      if ('betas' in p || 'fallbacks' in p || 'stream' in p) throw new Error('a batch request carried a live-only field');
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(r.custom_id)) throw new Error(`bad custom_id ${r.custom_id}`);
    }
    this.created.push({ id, requests: structuredClone(requests) });
    this.status.set(id, this.hold ? 'in_progress' : 'ended');
    return { id };
  }
  async retrieve(id: string) {
    this.retrieved++;
    return { id, processing_status: this.status.get(id) ?? 'ended' };
  }
  end(id: string) {
    this.status.set(id, 'ended');
  }
  async delete(id: string) {
    if (this.status.get(id) !== 'ended') throw new Error('only an ended batch can be deleted');
    this.deleted.push(id);
  }
  async results(id: string): Promise<AsyncIterable<BatchResultLine>> {
    const batch = this.created.find((b) => b.id === id)!;
    const lines = batch.requests.map((r) => this.answer(r.custom_id, r.params));
    return (async function* () {
      for (const l of lines) yield l;
    })();
  }
  private answer(custom_id: string, params: BatchParams): BatchResultLine {
    const part = partOf(params);
    if ((part === 'road' || part === 'keepers' || part === 'deeper-scout') && this.pauseNext[part] && params.messages.length === 1) {
      delete this.pauseNext[part];
      return { custom_id, result: { type: 'succeeded', message: pausedReply } } as BatchResultLine;
    }
    const fail = this.failNext[part];
    if (fail) {
      delete this.failNext[part];
      if (fail === 'expired') return { custom_id, result: { type: 'expired' } } as BatchResultLine;
      if (fail === 'refusal') return { custom_id, result: { type: 'succeeded', message: msg([], 'refusal') } } as BatchResultLine;
      return {
        custom_id,
        result: { type: 'errored', error: { type: 'error', error: { type: fail, message: 'scripted' }, request_id: null } },
      } as unknown as BatchResultLine;
    }
    const m0 = params.messages[0]?.content;
    const turn = typeof m0 === 'string' ? m0 : '';
    const question = /<question>([^<]*)<\/question>/.exec(turn)?.[1] ?? '-';
    const message =
      part === 'road'
        ? roadReply
        : part === 'keepers'
          ? keepersReply
          : part === 'deeper-scout'
            ? deeperScoutReply
            : part === 'deeper'
              ? json(goodAnswer(question === '-' ? null : question))
              : json(goodDraft(this.composeTitle));
    return { custom_id, result: { type: 'succeeded', message } } as BatchResultLine;
  }
  /** Every request sent, with its part. */
  sent() {
    return this.created.flatMap((b) => b.requests.map((r) => ({ batch: b.id, custom_id: r.custom_id, part: partOf(r.params), params: r.params })));
  }
}

// ---------------------------------------------------------------------------
// A scripted mind for the live lane

const mark: Mark = { status: 'verified', year: null, sources: [1] };

const waypoint = (i: number): DraftWaypoint => ({
  kind: i === 0 ? 'door' : i === 3 ? 'summit' : 'crucible',
  emblem: 'wave',
  name: `Waypoint ${i}`,
  when: i === 0 ? 'this week' : 'next spring',
  at: i === 0 ? null : '2099-03',
  where: { place: `Place ${i}`, town: 'Reykjavík', country: 'Iceland', geoQuery: `Place ${i}, Reykjavík, Iceland`, lat: null, lon: null, precision: null },
  clue: `Clue ${i}`,
  lore: false,
  trial: `TRIAL-${i}`,
  person: { name: `Keeper ${i}`, role: 'leader', verb: 'take you in', mark },
  earns: `Earns ${i}`,
  mystery: i === 2 ? 'Who leads the first night search' : null,
  steps: [{ kind: 'do', text: `Step ${i}`, mark }],
  noteIds: ['N1'],
});

export function simpleRoad(title: string): DraftRoad {
  return {
    title,
    calling: 'Walk into the hall, find the recruit leader, and do not quit until the team calls you one of its own.',
    truth: null,
    span: { amount: 2, unit: 'years' },
    thisWeek: { text: 'Write to the team about the open evening.', mark, day: null, minutes: 15 },
    provisions: { coin: [], papers: [], body: [{ text: 'Be fit for winter nights.', mark, counsel: false }], skills: [], tongue: [] },
    rule: null,
    sources: [{ n: 1, title: 'Storm Harbour', url: 'https://stormharbour.is/recruits', host: 'stormharbour.is', date: '2026', opened: true }],
    waypoints: [waypoint(0), waypoint(1), waypoint(2), waypoint(3)],
  };
}

type Step = 'ok' | 'fail' | 'silent' | 'block';

/** A mind that answers at once (or as scripted); counts what it was asked. */
export class PhaseMind implements LoracleMind {
  readonly kind = 'claude' as const;
  weighs = 0;
  casts = 0;
  draws = 0;
  deepers = 0;
  lastFrom: DrawFrom | null = null;
  lastAsk: DeeperAsk | null = null;
  weighing: Weighing = STORM_WEIGHING;
  castPlan: Step[] = [];
  drawPlan: Step[] = [];
  deeperPlan: Step[] = [];
  private gates: (() => void)[] = [];

  release() {
    this.gates.shift()?.();
  }
  get blocked() {
    return this.gates.length;
  }
  private async gate(signal: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
      this.gates.push(resolve);
      signal.addEventListener('abort', () => reject(new MindError('interrupted')), { once: true });
    });
  }

  async weigh(_wish: MindWish, _ctx: MindContext): Promise<WeighResult> {
    this.weighs++;
    return { verdict: { route: 'quest', weighing: this.weighing }, spend: [spend('weigh')] };
  }

  async cast(_wish: WeighedWish, _ctx: MindContext, onSign: SignSink, signal: AbortSignal): Promise<CastDraft> {
    this.casts++;
    const step = this.castPlan.shift() ?? 'ok';
    onSign({ kind: 'search', query: 'rescue team recruits' });
    if (step === 'block') await this.gate(signal);
    if (step === 'fail') throw new MindError('error', { spend: [spend('road', 'error')] });
    if (step === 'silent') return { kind: 'silent', spend: [spend('compose', 'refusal')] };
    onSign({ kind: 'compose' });
    onSign({ kind: 'seal' });
    return {
      kind: 'road',
      road: simpleRoad('The First Road'),
      rough: false,
      faults: [],
      forge: { secret: 'FORGE' },
      ledger: {
        notes: [{ id: 'N1', kind: 'person', name: 'Keeper 0', place: 'Reykjavík', text: 'Leads the recruits', status: 'verified', year: null, sources: [1] }],
        gaps: ['Who leads the first night search?'],
        dossiers: ['DOSSIER'],
      },
      spend: [spend('road'), spend('keepers'), spend('compose')],
    };
  }

  async draw(_wish: WeighedWish, _ctx: MindContext, from: DrawFrom, onSign: SignSink, signal: AbortSignal): Promise<CastDraft> {
    this.draws++;
    this.lastFrom = structuredClone(from);
    const step = this.drawPlan.shift() ?? 'ok';
    const signs: LoracleSign[] = [{ kind: 'compose' }];
    for (const s of signs) onSign(s);
    if (step === 'block') await this.gate(signal);
    if (step === 'fail') throw new MindError('error', { spend: [spend(from.task === 'again' ? 'again' : 'compose', 'error')] });
    if (step === 'silent') return { kind: 'silent', spend: [spend('again', 'refusal')] };
    onSign({ kind: 'seal' });
    return {
      kind: 'road',
      road: simpleRoad(from.task === 'again' ? `Another Road ${from.earlier.length + 1}` : 'The Resumed Road'),
      rough: false,
      faults: [],
      forge: null,
      ledger: from.ledger,
      spend: [spend(from.task === 'again' ? 'again' : 'compose', 'ok', 3000)],
    };
  }

  async deeper(ask: DeeperAsk, _ctx: MindContext, onSign: SignSink, signal: AbortSignal): Promise<DeeperDraft> {
    this.deepers++;
    this.lastAsk = structuredClone(ask);
    const step = this.deeperPlan.shift() ?? 'ok';
    onSign({ kind: 'search', query: `${ask.focus.waypoint.place} keeper` });
    if (step === 'block') await this.gate(signal);
    if (step === 'fail') throw new MindError('error', { spend: [spend('deeper-scout', 'error')] });
    if (step === 'silent') return { kind: 'silent', spend: [spend('deeper', 'refusal')] };
    onSign({ kind: 'compose' });
    onSign({ kind: 'seal' });
    return {
      kind: 'answer',
      answer: {
        answer: {
          answer: ask.focus.question ? 'Others came older and stayed.' : null,
          clue: 'A new clue',
          steps: [
            { kind: 'do', text: 'Step one', mark },
            { kind: 'do', text: 'Step two', mark },
            { kind: 'gate', text: 'Step three', mark },
          ],
          keeper: { name: 'Keeper 1', role: 'leader', verb: 'take you in', mark },
          words: 'I came to train.',
          unknown: 'Who leads the first night search.',
        },
        sources: [{ n: 1, title: 'Winter', url: 'https://stormharbour.is/winter', host: 'stormharbour.is', date: '2026', opened: false }],
      },
      found: [{ id: 'N2', kind: 'event', name: 'Night search', place: 'Reykjavík', text: 'First night search in winter', status: 'verified', year: null, sources: [2] }],
      rough: false,
      faults: [],
      spend: [spend('deeper-scout', 'ok', 2000), spend('deeper', 'ok', 2000)],
    };
  }
}
