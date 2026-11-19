// The Loracle's mind against a fake Anthropic client: no network, no key, no cost.
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { loracleConfig } from '../src/config.ts';
import { allText, batchParams, composeParams, CutOff, echoable, failureOf, finalText, MAX_RESENDS, partialReply, readStructured, type Block, type MindClient, type Params, type Reply } from '../src/lib/loracle/client.ts';
import { WeighingWire } from '../src/lib/loracle/schema.ts';
import { priceMessage, SEARCH_USD, spendOf } from '../src/lib/loracle/cost.ts';
import { fakeMind } from '../src/lib/loracle/fake.ts';
import { claudeMind, mindFor, verdictOf } from '../src/lib/loracle/mind.ts';
import { AGAIN_ADDENDUM, COMPOSE_PROMPT, DEEPER_ADDENDUM, SCOUT_PROMPT, WEIGH_PROMPT } from '../src/lib/loracle/prompts.ts';
import { deeperScoutReply, goodAnswer } from './loracleFixtures.ts';
import { MindError, type MindContext, type MindWish, type Weighing } from '../src/lib/loracle/types.ts';
import type { LoracleSign } from '#shared';

type Message = Anthropic.Beta.BetaMessage;

const ANON = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CTX: MindContext = {
  realm: { label: 'Reykjavík', country: 'IS' },
  reachKm: 20000,
  callings: ['sea', 'wild'],
  lorer: { age: '25-34', money: 'some', time: 'evenings', body: null, languages: 'Icelandic, English', passport: null },
  today: 'Wednesday 18 November 2026',
  todayIso: '2026-11-18',
  timeZone: 'Atlantic/Reykjavik',
  anonId: ANON,
};
const WISH: MindWish = { text: 'I wish to have friends who would drive into a storm for me.', riddleAnswer: null, rerouted: false };

const config = () => loracleConfig({ apiKey: 'sk-test-not-real', anonSalt: 'salt' });

function msg(content: unknown[], stop: string = 'end_turn', usage: Record<string, unknown> = {}, model = 'claude-opus-5-5'): Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model,
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
      service_tier: 'standard',
      ...usage,
    },
  } as unknown as Message;
}
const text = (t: string) => ({ type: 'text', text: t, citations: null });
const json = (v: unknown) => msg([{ type: 'thinking', thinking: '', signature: 'sig' }, text(JSON.stringify(v))]);

type Stage = 'weigh' | 'road' | 'keepers' | 'compose' | 'repair';
const stageOf = (p: Params): Stage => {
  const sys = Array.isArray(p.system) ? p.system[0]!.text : String(p.system);
  const first = p.messages[0]!.content;
  const turn = typeof first === 'string' ? first : '';
  if (sys === WEIGH_PROMPT) return 'weigh';
  if (sys === SCOUT_PROMPT) return turn.includes('ROLE: ROAD') ? 'road' : 'keepers';
  if (sys === COMPOSE_PROMPT) return turn.includes('<faults>') ? 'repair' : 'compose';
  throw new Error('unknown request');
};

/** A scripted stand-in for client.beta.messages: each stage answers from its own queue. */
class FakeClient implements MindClient {
  calls: { stage: Stage; params: Params; signal: AbortSignal }[] = [];
  private script: Partial<Record<Stage, (Message | Error)[]>>;
  constructor(script: Partial<Record<Stage, (Message | Error)[]>>) {
    this.script = script;
  }
  private next(params: Params, signal: AbortSignal): Message {
    const stage = stageOf(params);
    this.calls.push({ stage, params: structuredClone(params), signal });
    const queue = this.script[stage] ?? [];
    const answer = queue.length > 1 ? queue.shift()! : queue[0];
    if (!answer) throw new Error(`no scripted answer for ${stage}`);
    if (answer instanceof Error) throw answer;
    return answer;
  }
  async create(params: Params, options: { signal: AbortSignal }): Promise<Reply> {
    return { message: this.next(params, options.signal), requestId: 'req_create' };
  }
  async stream(params: Params, options: { signal: AbortSignal }, onBlock?: (b: Block) => void): Promise<Reply> {
    const message = this.next(params, options.signal);
    for (const b of message.content) onBlock?.(b);
    return { message, requestId: 'req_stream' };
  }
  of(stage: Stage) {
    return this.calls.filter((c) => c.stage === stage);
  }
}

// ---------------------------------------------------------------------------
// A small world for a full cast (made-up team and people, home country only)

const WEIGHING: Weighing = {
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

const ROAD_DOSSIER = `ROLE: ROAD
R1 | near | Storm Harbour Rescue Team | Reykjavík, Iceland | 64.15,-21.95 | Volunteer rescue team; recruit intake each autumn; open evening Wednesday 20:00 | VERIFIED | https://stormharbour.is/recruits | 2026-09-01
R2 | gate | Recruit year | Storm Harbour Rescue Team, Reykjavík, Iceland | - | Recruits train 18 months before full membership; minimum age 18 | VERIFIED | https://stormharbour.is/recruits | 2026-09-01
R3 | place | Hvalfjörður training ground | Hvalfjörður, Iceland | - | Winter search drills held each February | REPORTED | https://example-news.is/drills | 2026-02-10
R4 | place | Landsbjörg Rescue School | Reykjavík, Iceland | - | Runs the national first-aid course for rescue recruits, 40 hours | VERIFIED | https://rescueschool.is/courses | 2026-08-01
GAPS: Which night will the team call its recruits out first?`;

const KEEPERS_DOSSIER = `ROLE: KEEPERS
K1 | person | Sigrún Hafsteinsdóttir | Storm Harbour Rescue Team, Reykjavík, Iceland | - | Recruit leader who takes in the new recruits each autumn | VERIFIED | https://stormharbour.is/team | 2026-09-01
K2 | person | Kári Jónsson | Landsbjörg Rescue School, Reykjavík, Iceland | - | Lead first-aid instructor | VERIFIED | https://rescueschool.is/team | 2026-08-01
K3 | detail | Orange hall | Storm Harbour Rescue Team, Reykjavík, Iceland | - | The team's hall has orange boats stacked by the door | VERIFIED | https://stormharbour.is/team | 2026-09-01
K4 | person | Sigrún Hafsteinsdóttir | Storm Harbour Rescue Team, Reykjavík, Iceland | - | Led the autumn intake | VERIFIED | https://stormharbour.is/recruits | 2026-09-01`;

const searchResult = (id: string, urls: string[]) => ({
  type: 'web_search_tool_result',
  tool_use_id: id,
  content: urls.map((url) => ({ type: 'web_search_result', url, title: url, page_age: null, encrypted_content: 'x' })),
});

const roadReply = msg(
  [
    { type: 'server_tool_use', id: 'srv_r1', name: 'web_search', input: { query: 'Storm Harbour rescue recruits 2026' } },
    searchResult('srv_r1', ['https://stormharbour.is/recruits', 'https://example-news.is/drills']),
    { type: 'server_tool_use', id: 'srv_r2', name: 'web_fetch', input: { url: 'https://rescueschool.is/courses' } },
    {
      type: 'web_fetch_tool_result',
      tool_use_id: 'srv_r2',
      content: { type: 'web_fetch_result', url: 'https://rescueschool.is/courses', retrieved_at: '2026-11-18', content: { type: 'document', title: 'Courses', source: { type: 'text', media_type: 'text/plain', data: 'x' }, citations: null } },
    },
    text(ROAD_DOSSIER),
  ],
  'end_turn',
  { server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } },
);
const keepersReply = msg(
  [
    { type: 'server_tool_use', id: 'srv_k1', name: 'web_search', input: { query: 'Storm Harbour team recruit leader' } },
    searchResult('srv_k1', ['https://stormharbour.is/team', 'https://rescueschool.is/team']),
    text(KEEPERS_DOSSIER),
  ],
  'end_turn',
  { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
);

/** A draft that passes every check against the ledger the dossiers above settle into. */
function goodDraft() {
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
    title: 'The Orange Boats',
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
        at: '2026-11-25',
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
      day: '2026-11-20',
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

const quest = (over: Partial<Record<string, unknown>> = {}) => ({
  route: 'quest',
  riddle: null,
  offer: null,
  ...WEIGHING,
  ...over,
});

const castWith = (client: FakeClient, signal = new AbortController().signal) => {
  const signs: LoracleSign[] = [];
  const mind = claudeMind(config(), { client });
  return { signs, run: () => mind.cast({ ...WISH, weighing: WEIGHING }, CTX, (s) => signs.push(s), signal) };
};

// ---------------------------------------------------------------------------

describe('weigh', () => {
  it('routes a quest and keeps its weighing; code adds youth for 13 to 17 and dangerous for lethal', async () => {
    const client = new FakeClient({ weigh: [json(quest({ tags: ['lethal'] }))] });
    const mind = claudeMind(config(), { client });
    const r = await mind.weigh(WISH, { ...CTX, lorer: { ...CTX.lorer, age: '13-17' } }, new AbortController().signal);
    expect(r.verdict.route).toBe('quest');
    if (r.verdict.route !== 'quest') throw new Error();
    expect(r.verdict.weighing.tags).toEqual(expect.arrayContaining(['lethal', 'dangerous', 'youth']));
    expect(r.verdict.weighing.roadPlan).toEqual(WEIGHING.roadPlan);
    expect(r.spend).toHaveLength(1);
    expect(r.spend[0]).toMatchObject({ stage: 'weigh', outcome: 'ok', model: 'claude-opus-5-5', requestId: 'req_create' });
  });

  it('routes care, riddle and reroute, and stores nothing for them', async () => {
    const run = async (answer: unknown, wish: MindWish = WISH) =>
      claudeMind(config(), { client: new FakeClient({ weigh: [json(answer)] }) }).weigh(wish, CTX, new AbortController().signal);

    expect((await run(quest({ route: 'care' }))).verdict).toEqual({ route: 'care' });
    const riddle = await run(quest({ route: 'riddle', riddle: { question: 'Happy like…', options: ['a roaring crowd', 'a quiet morning', 'someone beside you', 'a fourth'] } }));
    expect(riddle.verdict).toEqual({ route: 'riddle', riddle: { question: 'Happy like…', options: ['a roaring crowd', 'a quiet morning', 'someone beside you'] } });
    expect(riddle.spend[0]!.outcome).toBe('riddle');
    const reroute = await run(quest({ route: 'reroute', offer: 'I wish to become so strong that no one can break me.' }));
    expect(reroute.verdict).toEqual({ route: 'reroute', offer: 'I wish to become so strong that no one can break me.' });
    // An offer that isn't a wish is never shown.
    expect((await run(quest({ route: 'reroute', offer: 'Go to the police.' }))).verdict).toEqual({ route: 'silent' });
    // A riddle answer settles the riddle. A taken offer still weighed as harm is never drawn: silence.
    expect((await run(quest({ route: 'riddle', riddle: { question: 'x', options: ['a', 'b', 'c'] } }), { ...WISH, riddleAnswer: 'a roaring crowd' })).verdict.route).toBe('quest');
    expect((await run(quest({ route: 'reroute', offer: 'I wish x' }), { ...WISH, rerouted: true })).verdict).toEqual({ route: 'silent' });
    expect((await run(quest(), { ...WISH, rerouted: true })).verdict.route).toBe('quest');
  });

  it('answers the care floor without asking the model', async () => {
    const client = new FakeClient({});
    const r = await claudeMind(config(), { client }).weigh({ ...WISH, text: 'I wish I could just disappear and never wake up' }, CTX, new AbortController().signal);
    expect(r).toEqual({ verdict: { route: 'care' }, spend: [] });
    expect(client.calls).toHaveLength(0);
  });

  it('treats a refusal as silence, counted but not a failure', async () => {
    const client = new FakeClient({ weigh: [msg([], 'refusal')] });
    const r = await claudeMind(config(), { client }).weigh(WISH, CTX, new AbortController().signal);
    expect(r.verdict).toEqual({ route: 'silent' });
    expect(r.spend.map((s) => s.outcome)).toEqual(['refusal']);
  });

  it('retries once with more room when cut off, and fails on output it cannot read', async () => {
    const client = new FakeClient({ weigh: [msg([text('{"route":')], 'max_tokens'), json(quest())] });
    const r = await claudeMind(config(), { client }).weigh(WISH, CTX, new AbortController().signal);
    expect(r.verdict.route).toBe('quest');
    expect(client.calls.map((c) => c.params.max_tokens)).toEqual([8000, 16000]);
    expect(r.spend.map((s) => s.outcome)).toEqual(['max_tokens', 'ok']);

    const bad = new FakeClient({ weigh: [msg([text('not json')])] });
    await expect(claudeMind(config(), { client: bad }).weigh(WISH, CTX, new AbortController().signal)).rejects.toMatchObject({ failure: 'error' });
  });

  it('reads only what follows the last fallback block', () => {
    const content = [text('{"partial'), { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: {} }, text('{"ok":1}')] as unknown as Block[];
    expect(finalText(content)).toBe('{"ok":1}');
  });

  it('builds the verdict defensively', () => {
    const v = verdictOf({ ...quest(), route: 'quest', tags: [] } as never, WISH, CTX);
    expect(v.route === 'quest' && v.weighing.tags).toEqual(['open']);
  });
});

describe('every request', () => {
  it('sets effort, server-side fallbacks and the anonymous id; never thinking off, a budget or forced tools', async () => {
    const client = new FakeClient({ weigh: [json(quest())], road: [roadReply], keepers: [keepersReply], compose: [json(goodDraft())] });
    await claudeMind(config(), { client }).weigh(WISH, CTX, new AbortController().signal);
    await castWith(client).run();
    expect(client.calls.map((c) => c.stage)).toEqual(['weigh', 'road', 'keepers', 'compose']);
    for (const { stage, params } of client.calls) {
      expect(params.model).toBe('claude-opus-5-5');
      expect(params.output_config?.effort).toBeTruthy();
      expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
      expect(params.fallbacks).toBe('default');
      expect(params.metadata).toEqual({ user_id: ANON });
      expect(params).not.toHaveProperty('thinking');
      expect(params).not.toHaveProperty('tool_choice');
      const last = Array.isArray(params.system) ? params.system.at(-1) : null;
      expect(last?.cache_control).toEqual({ type: 'ephemeral' });
      // The realm is a town and a country: no key, and no coordinates before the ledger brings a place's own.
      const body = JSON.stringify(params);
      expect(body).not.toContain('sk-test-not-real');
      if (stage !== 'compose') expect(body).not.toMatch(/-?\d{1,2}\.\d+,\s*-?\d{1,3}\.\d+/);
    }
    const [weigh, road, keepers, compose] = client.calls.map((c) => c.params);
    expect(weigh!.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(road!.output_config).toEqual({ effort: 'medium' });
    expect(compose!.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } });
    expect(road!.tools).toEqual([
      expect.objectContaining({ type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', city: 'Reykjavík', country: 'IS', timezone: 'Atlantic/Reykjavik' } }),
      expect.objectContaining({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 8000 }),
    ]);
    expect(keepers!.tools?.[1]).toMatchObject({ max_uses: 4 });
    expect(compose!.tools).toBeUndefined();
    // The user turn carries the stone's questions: reach and callings.
    expect(weigh!.messages[0]!.content).toContain('Will travel: anywhere on Earth. Calls to them: the sea, the wild places.');
    expect(weigh!.messages[0]!.content).toContain('Passport: Iceland (assumed from home).');
  });
});

describe('the scouts', () => {
  it('resend a paused turn with the assistant content appended unchanged and no new user turn', async () => {
    const paused = msg([{ type: 'thinking', thinking: '', signature: 'sig1' }, { type: 'server_tool_use', id: 'srv_p', name: 'web_search', input: { query: 'Storm Harbour rescue recruits 2026' } }, searchResult('srv_p', ['https://stormharbour.is/recruits'])], 'pause_turn');
    const client = new FakeClient({ road: [paused, roadReply], keepers: [keepersReply], compose: [json(goodDraft())] });
    const { run } = castWith(client);
    const r = await run();
    expect(r.kind).toBe('road');
    const roads = client.of('road');
    expect(roads).toHaveLength(2);
    const second = roads[1]!.params.messages;
    expect(second).toHaveLength(2);
    expect(second[0]).toEqual(roads[0]!.params.messages[0]);
    expect(second[1]).toEqual({ role: 'assistant', content: paused.content });
    expect(second.filter((m) => m.role === 'user')).toHaveLength(1);
    // One spend row per request.
    expect(r.spend.filter((s) => s.stage === 'road')).toHaveLength(2);
  });

  it(`stop after ${MAX_RESENDS} resends`, async () => {
    const paused = msg(roadReply.content, 'pause_turn');
    const client = new FakeClient({ road: [paused], keepers: [keepersReply], compose: [json(goodDraft())] });
    await castWith(client).run();
    expect(client.of('road')).toHaveLength(1 + MAX_RESENDS);
  });

  it('echo a fallback turn without the declined model’s thinking and unanswered tool calls', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'server_tool_use', id: 'a', name: 'web_search', input: {} },
      { type: 'server_tool_use', id: 'b', name: 'web_search', input: {} },
      searchResult('b', []),
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: {} },
      { type: 'thinking', thinking: '', signature: 't' },
      text('after'),
    ] as unknown as Block[];
    const echoed = echoable(content);
    expect(echoed.map((b) => b.type)).toEqual(['server_tool_use', 'web_search_tool_result', 'fallback', 'thinking', 'text']);
    expect((echoed[0] as { id: string }).id).toBe('b');
    const plain = [content[0]!, content[6]!];
    expect(echoable(plain)).toEqual(plain);
  });

  it('retell real searches and fetches as signs, in order, and only once each', async () => {
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(goodDraft())] });
    const { signs, run } = castWith(client);
    await run();
    expect(signs).toEqual([
      { kind: 'search', query: 'Storm Harbour rescue recruits 2026' },
      { kind: 'fetch', host: 'rescueschool.is' },
      { kind: 'search', query: 'Storm Harbour team recruit leader' },
      { kind: 'name' },
      { kind: 'cost' },
      { kind: 'compose' },
      { kind: 'seal' },
    ]);
  });

  it('go silent when both refuse, and carry on when only one does', async () => {
    const both = new FakeClient({ road: [msg([], 'refusal')], keepers: [msg([], 'refusal')] });
    const r = await castWith(both).run();
    expect(r).toMatchObject({ kind: 'silent' });
    expect(r.spend.map((s) => s.outcome)).toEqual(['refusal', 'refusal']);
    expect(both.of('compose')).toHaveLength(0);

    // Without the keepers the draft's people rest on nothing: the road is drawn, but rough.
    const one = new FakeClient({ road: [roadReply], keepers: [msg([], 'refusal')], compose: [json(goodDraft())], repair: [json(goodDraft())] });
    const r2 = await castWith(one).run();
    expect(r2).toMatchObject({ kind: 'road', rough: true });
    expect(r2.spend.map((s) => `${s.stage} ${s.outcome}`)).toEqual(['road ok', 'keepers refusal', 'compose ok', 'repair ok']);
  });
});

describe('a cast', () => {
  it('draws a checked road with marks from the notes, keeping the forge, ledger and spend', async () => {
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(goodDraft())] });
    const r = await castWith(client).run();
    if (r.kind !== 'road') throw new Error(r.kind);
    expect(r.rough).toBe(false);
    expect(r.faults.filter((f) => /^[HX]/.test(f))).toEqual([]);
    expect(r.road.title).toBe('The Orange Boats');
    expect(r.road.waypoints).toHaveLength(3);
    expect(r.road.waypoints[0]!.where).toMatchObject({ lat: 64.15, lon: -21.95, precision: 'ledger' });
    expect(r.road.waypoints[0]!.person?.mark).toMatchObject({ status: 'verified' });
    expect(r.road.waypoints[2]!.steps[0]!.mark).toMatchObject({ status: 'reported' });
    expect(r.road.sources.every((s, i) => s.n === i + 1)).toBe(true);
    expect(r.road.sources.map((s) => s.url)).toContain('https://stormharbour.is/recruits');
    expect(r.forge).toMatchObject({ chosen: 'The team that goes out into storms.' });
    expect(r.ledger?.notes).toHaveLength(7);
    expect(r.ledger?.gaps).toEqual(['Which night will the team call its recruits out first?']);
    expect(r.spend.map((s) => s.stage)).toEqual(['road', 'keepers', 'compose']);
    // The road the client sees never carries note ids.
    expect(JSON.stringify({ ...r.road, waypoints: r.road.waypoints.map(({ noteIds: _n, ...w }) => w) })).not.toMatch(/"N\d+"/);
  });

  it('repairs once on a hard fault, with the faults in a fresh user turn at repair effort', async () => {
    const bad = goodDraft();
    bad.calling = 'Embark on a journey to the Storm Harbour hall and find Sigrún Hafsteinsdóttir until the team calls you its own.';
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(bad)], repair: [json(goodDraft())] });
    const { signs, run } = castWith(client);
    const r = await run();
    if (r.kind !== 'road') throw new Error(r.kind);
    expect(r.rough).toBe(false);
    const repair = client.of('repair');
    expect(repair).toHaveLength(1);
    const turn = repair[0]!.params.messages;
    expect(turn).toHaveLength(1);
    expect(turn[0]!.role).toBe('user');
    expect(String(turn[0]!.content)).toMatch(/<faults>[\s\S]*"embark"[\s\S]*<\/faults>/);
    expect(repair[0]!.params.output_config?.effort).toBe('medium');
    expect(signs.map((s) => s.kind)).toEqual(expect.arrayContaining(['compose', 'repair', 'seal']));
    expect(r.spend.map((s) => s.stage)).toEqual(['road', 'keepers', 'compose', 'repair']);
    expect(r.faults).toEqual(expect.arrayContaining(['repair', 'H1 calling']));
  });

  it('marks the road rough when hard faults outlive the repair', async () => {
    const bad = goodDraft();
    bad.map[0]!.clue = 'Bring a ticket to the reception.';
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(bad)], repair: [json(bad)] });
    const r = await castWith(client).run();
    expect(r).toMatchObject({ kind: 'road', rough: true });
    expect(client.of('repair')).toHaveLength(1);
  });

  it('fails the road when safety faults outlive the repair and a fresh compose', async () => {
    const unsafe = goodDraft();
    unsafe.map[2]!.road[0]!.text = 'Ask Sigrún Hafsteinsdóttir every week until she gives in.';
    unsafe.map[2]!.road[0]!.noteIds = ['N3', 'N5'];
    unsafe.map[2]!.noteIds.push('N5');
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(unsafe)], repair: [json(unsafe)] });
    const err = await castWith(client).run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MindError);
    expect((err as MindError).failure).toBe('error');
    expect((err as MindError).spend.map((s) => s.stage)).toEqual(['road', 'keepers', 'compose', 'repair', 'repair']);
  });

  it('ends silent when compose is refused', async () => {
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [msg([], 'refusal')] });
    const r = await castWith(client).run();
    expect(r.kind).toBe('silent');
    expect(r.spend.at(-1)).toMatchObject({ stage: 'compose', outcome: 'refusal' });
  });

  it('repairs JSON the schema rejects (H17)', async () => {
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [msg([text('{"title": 3}')])], repair: [json(goodDraft())] });
    const r = await castWith(client).run();
    expect(r.kind).toBe('road');
    expect(String(client.of('repair')[0]!.params.messages[0]!.content)).toContain('H17');
  });

  it('fails when the scouts bring back too little to draw from', async () => {
    const thin = msg([searchResult('x', ['https://stormharbour.is/recruits']), text(ROAD_DOSSIER.split('\n').slice(0, 2).join('\n'))]);
    const client = new FakeClient({ road: [thin], keepers: [msg([text('ROLE: KEEPERS\nGAPS: -')])] });
    await expect(castWith(client).run()).rejects.toMatchObject({ failure: 'error' });
  });
});

describe('failures', () => {
  const headers = new Headers({ 'request-id': 'req_err' });
  it('map the SDK’s typed errors, never their messages', () => {
    expect(failureOf(new Anthropic.RateLimitError(429, {}, 'slow down', headers))).toEqual({ failure: 'overloaded', requestId: 'req_err' });
    expect(failureOf(new Anthropic.InternalServerError(529, {}, 'overloaded', headers)).failure).toBe('overloaded');
    expect(failureOf(new Anthropic.APIConnectionError({ message: 'reset' })).failure).toBe('overloaded');
    expect(failureOf(new Anthropic.APIConnectionTimeoutError()).failure).toBe('timeout');
    expect(failureOf(new Anthropic.AuthenticationError(401, {}, 'bad key', headers)).failure).toBe('error');
    expect(failureOf(new Anthropic.BadRequestError(400, {}, 'bad', headers)).failure).toBe('error');
    expect(failureOf(new Error('anything')).failure).toBe('error');
  });

  it('tell a timeout from a shutdown by the abort reason', () => {
    const t = new AbortController();
    t.abort(new DOMException('slow', 'TimeoutError'));
    expect(failureOf(new Anthropic.APIUserAbortError(), t.signal).failure).toBe('timeout');
    const s = new AbortController();
    s.abort();
    expect(failureOf(new Anthropic.APIUserAbortError(), s.signal).failure).toBe('interrupted');
  });

  it('throw MindError with what was already spent, and never the wish', async () => {
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [new Anthropic.RateLimitError(429, {}, 'x', headers)] });
    const err = (await castWith(client).run().catch((e: unknown) => e)) as MindError;
    expect(err).toBeInstanceOf(MindError);
    expect(err.failure).toBe('overloaded');
    expect(err.requestId).toBe('req_err');
    expect(err.spend.map((s) => s.stage)).toEqual(['road', 'keepers']);
    expect(err.message).not.toContain('storm');

    const weighErr = await claudeMind(config(), { client: new FakeClient({ weigh: [new Anthropic.APIConnectionTimeoutError()] }) })
      .weigh(WISH, CTX, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(weighErr).toMatchObject({ failure: 'timeout' });
  });

  it('stop at once when the job is cut off', async () => {
    const ac = new AbortController();
    ac.abort(new DOMException('slow', 'TimeoutError'));
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply] });
    await expect(castWith(client, ac.signal).run()).rejects.toMatchObject({ failure: 'timeout' });
    expect(client.calls).toHaveLength(0);
  });
});

describe('cost', () => {
  const usage = (u: Record<string, unknown>) => ({
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: null,
    server_tool_use: null,
    iterations: null,
    ...u,
  });
  const price = (u: Record<string, unknown>, model = 'claude-opus-5-5', batch = false) =>
    priceMessage({ model, usage: usage(u) } as unknown as Message, 'claude-opus-5-5', { batch });

  it('prices tokens at Claude Opus 5.5 rates: $4 in, $20 out, $5 / $8 cache writes, $0.20 reads', () => {
    expect(price({ input_tokens: 1_000_000 }).costMicros).toBe(4_000_000);
    expect(price({ output_tokens: 1_000_000 }).costMicros).toBe(20_000_000);
    expect(price({ cache_read_input_tokens: 1_000_000 }).costMicros).toBe(200_000);
    expect(price({ cache_creation_input_tokens: 1_000_000 }).costMicros).toBe(5_000_000);
    expect(
      price({ cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } }).costMicros,
    ).toBe(8_000_000);
  });

  it('adds the search fee and halves tokens in a batch', () => {
    const p = price({ input_tokens: 10_000, output_tokens: 2_000, server_tool_use: { web_search_requests: 6, web_fetch_requests: 3 } });
    expect(p).toMatchObject({ searches: 6, fetches: 3, inputTokens: 10_000, outputTokens: 2_000 });
    expect(p.costMicros).toBe(Math.round((10_000 * 4 + 2_000 * 20) / 1e6 * 1e6 + 6 * SEARCH_USD * 1e6));
    expect(price({ input_tokens: 1_000_000 }, 'claude-opus-5-5', true).costMicros).toBe(2_000_000);
  });

  it('prices each iteration at its own model, a fallback at the fallback model’s rates', () => {
    const p = priceMessage(
      {
        model: 'claude-opus-5',
        usage: usage({
          input_tokens: 500_000,
          output_tokens: 0,
          iterations: [
            { type: 'message', model: null, input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
            { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
          ],
        }),
      } as unknown as Message,
      'claude-opus-5-5',
    );
    // 1M at $4 (the declined Opus 5.5 attempt) + 1M at $5 and 0.1M out at $25 (Opus 5).
    expect(p.costMicros).toBe(4_000_000 + 5_000_000 + 2_500_000);
    expect(p.model).toBe('claude-opus-5');
    expect(p.inputTokens).toBe(2_000_000);
  });
});

describe('the dev fake mind', () => {
  const signal = () => new AbortController().signal;
  it('routes like the real one: care, riddle, reroute, quest', async () => {
    const mind = fakeMind({ stepMs: 0 });
    expect((await mind.weigh({ ...WISH, text: 'I want to die' }, CTX, signal())).verdict.route).toBe('care');
    expect((await mind.weigh({ ...WISH, text: 'I wish to be happy.' }, CTX, signal())).verdict).toMatchObject({ route: 'riddle', riddle: { question: 'Happy like…' } });
    expect((await mind.weigh({ ...WISH, text: 'I wanna be happy' }, CTX, signal())).verdict.route).toBe('riddle');
    expect((await mind.weigh({ ...WISH, text: 'I wish to get back at my ex.' }, CTX, signal())).verdict.route).toBe('reroute');
    const q = await mind.weigh({ ...WISH, text: 'I wish to become the Lethwei champion of the world.' }, CTX, signal());
    expect(q.verdict.route).toBe('quest');
    expect(q.spend[0]).toMatchObject({ model: 'fake', costMicros: 0 });
  });

  it('walks the phases in order and draws a canned road, with no network and no cost', async () => {
    const mind = fakeMind({ stepMs: 0 });
    const weighed = await mind.weigh({ ...WISH, text: 'I wish to become the Lethwei champion of the world.' }, CTX, signal());
    if (weighed.verdict.route !== 'quest') throw new Error();
    const signs: LoracleSign[] = [];
    const r = await mind.cast({ ...WISH, text: 'I wish to become the Lethwei champion of the world.', weighing: weighed.verdict.weighing }, CTX, (s) => signs.push(s), signal());
    const kinds = signs.map((s) => s.kind);
    expect(kinds.indexOf('compose')).toBeGreaterThan(kinds.lastIndexOf('search'));
    expect(kinds.at(-1)).toBe('seal');
    if (r.kind !== 'road') throw new Error();
    expect(r.road.title).toBe('The Ninth Limb');
    expect(r.road.calling).toMatch(/Lone Chaw.*do not leave until/);
    expect(r.road.waypoints.length).toBeGreaterThanOrEqual(3);
    expect(r.spend.every((s) => s.model === 'fake' && s.costMicros === 0)).toBe(true);
    const generic = await mind.cast({ ...WISH, weighing: WEIGHING }, CTX, () => {}, signal());
    expect(generic.kind === 'road' && generic.road.calling).toContain('Reykjavík');
  });

  it('stops when the job is cut off', async () => {
    const ac = new AbortController();
    const mind = fakeMind({ stepMs: 50 });
    const p = mind.cast({ ...WISH, weighing: WEIGHING }, CTX, () => {}, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ failure: 'interrupted' });
  });
});

describe('which mind', () => {
  it('Claude when awake, the fake only when asked for, none while asleep', () => {
    expect(mindFor(loracleConfig({ anonSalt: 'x' }))).toBeUndefined();
    expect(mindFor(loracleConfig({ mind: 'fake', anonSalt: 'x' }))?.kind).toBe('fake');
    expect(mindFor(loracleConfig({ apiKey: 'sk-test', anonSalt: 'x' }))?.kind).toBe('claude');
  });
});

describe('the edges the reviewers found', () => {
  it('reads an overloaded error that arrives inside a stream (no status) as overloaded', () => {
    const inStream = new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error' } }, undefined, new Headers(), 'overloaded_error');
    expect(failureOf(inStream).failure).toBe('overloaded');
    const apiErr = new Anthropic.APIError(undefined, { type: 'error', error: { type: 'api_error' } }, undefined, new Headers(), 'api_error');
    expect(failureOf(apiErr).failure).toBe('overloaded');
    const slow = new Anthropic.APIError(undefined, { type: 'error', error: { type: 'timeout_error' } }, undefined, new Headers(), 'timeout_error');
    expect(failureOf(slow).failure).toBe('timeout');
    const bad = new Anthropic.APIError(undefined, { type: 'error', error: { type: 'invalid_request_error' } }, undefined, new Headers(), 'invalid_request_error');
    expect(failureOf(bad).failure).toBe('error');
    expect(failureOf(new CutOff(inStream, { message: msg([]), requestId: 'req_cut' }))).toEqual({ failure: 'overloaded', requestId: 'req_cut' });
  });

  it('reads a streamed answer that a fallback model finished, across the boundary', () => {
    const boundary = { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: {} };
    const whole = JSON.stringify(quest());
    const cut = whole.length >> 1;
    const streamed = msg([text(whole.slice(0, cut)), boundary, text(whole.slice(cut))]);
    const read = readStructured(streamed, WeighingWire);
    expect(read.kind).toBe('ok');
    expect(allText(streamed.content)).toBe(whole);
    // A non-streamed reply omits the partial: what follows the boundary is the whole answer.
    expect(readStructured(msg([boundary, text(whole)]), WeighingWire).kind).toBe('ok');
  });

  it('fails cleanly when the scouts keep their notes in thinking and write no dossier', async () => {
    const silentScout = msg([
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'server_tool_use', id: 'srv_t1', name: 'web_search', input: { query: 'Storm Harbour rescue' } },
      searchResult('srv_t1', ['https://stormharbour.is/recruits']),
      { type: 'thinking', thinking: '', signature: 'sig' },
    ]);
    const client = new FakeClient({ road: [silentScout], keepers: [silentScout] });
    const err = (await castWith(client).run().catch((e: unknown) => e)) as MindError;
    expect(err).toBeInstanceOf(MindError);
    expect(err.failure).toBe('error');
    expect(err.spend.map((s) => s.stage)).toEqual(['road', 'keepers']);
    expect(client.of('compose')).toHaveLength(0);
    expect(SCOUT_PROMPT).toContain('Write nothing between searches.');
  });

  it('counts what a scout cut off part-way had already cost', async () => {
    const partial = msg([{ type: 'server_tool_use', id: 'srv_c1', name: 'web_search', input: { query: 'x' } }], 'end_turn', { output_tokens: 1 });
    const client = new FakeClient({ road: [roadReply], keepers: [new CutOff(new Anthropic.APIUserAbortError(), partialReply(partial, 'req_cut'))] });
    const err = (await castWith(client).run().catch((e: unknown) => e)) as MindError;
    expect(err).toBeInstanceOf(MindError);
    const cut = err.spend.find((s) => s.stage === 'keepers');
    expect(cut).toMatchObject({ outcome: 'error', searches: 1, requestId: 'req_cut' });
    expect(cut!.costMicros).toBeGreaterThan(0);
  });

  it('does not start the larger compose when the job could not see it through', async () => {
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [msg([text('{"title"')], 'max_tokens')] });
    const mind = claudeMind(config(), { client });
    const err = (await mind
      .cast({ ...WISH, weighing: WEIGHING }, CTX, () => undefined, new AbortController().signal, { deadline: Date.now() + 60_000 })
      .catch((e: unknown) => e)) as MindError;
    expect(err).toMatchObject({ failure: 'timeout' });
    expect(client.of('compose')).toHaveLength(1);
    expect(err.spend.map((s) => `${s.stage}:${s.outcome}`)).toEqual(['road:ok', 'keepers:ok', 'compose:max_tokens']);
  });

  it('asks each keeper for a deed that follows “Ask them to”', () => {
    expect(COMPOSE_PROMPT).toContain('written to follow the words "Ask them to"');
  });
});

// ---------------------------------------------------------------------------
// Phase B: another road from a kept ledger, a deeper ask, and the batch form of a request

describe('Ask again (draw)', () => {
  const EARLIER = [
    {
      title: 'The First Watch',
      calling: 'Find Sigrún Hafsteinsdóttir.',
      keepers: ['Sigrún Hafsteinsdóttir'],
      waypoints: [{ name: 'The Hall', place: 'Storm Harbour Rescue Team' }],
    },
  ];

  async function firstRoad() {
    const r = await castWith(new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(goodDraft())] })).run();
    if (r.kind !== 'road') throw new Error(r.kind);
    return r;
  }

  it('keeps the whole ledger with the cast, and draws from it again with no scouts and the AGAIN task', async () => {
    const first = await firstRoad();
    expect(first.ledger?.sources?.length).toBeGreaterThan(0);
    expect(first.ledger?.seen?.map((s) => s.url)).toContain('https://stormharbour.is/recruits');
    const client = new FakeClient({ compose: [json({ ...goodDraft(), title: 'The Second Watch' })] });
    const signs: LoracleSign[] = [];
    const r = await claudeMind(config(), { client }).draw(
      { ...WISH, weighing: WEIGHING },
      CTX,
      { task: 'again', ledger: first.ledger!, earlier: EARLIER, sources: [] },
      (s) => signs.push(s),
      new AbortController().signal,
    );
    if (r.kind !== 'road') throw new Error(r.kind);
    expect(r.road.title).toBe('The Second Watch');
    expect(client.of('road')).toHaveLength(0);
    expect(client.of('keepers')).toHaveLength(0);
    const call = client.of('compose')[0]!.params;
    const system = call.system as { text: string; cache_control?: unknown }[];
    expect(system.map((b) => b.text)).toEqual([COMPOSE_PROMPT, AGAIN_ADDENDUM]);
    expect(system[0]!.cache_control).toBeUndefined();
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(String(call.messages[0]!.content)).toContain('<earlier_roads>');
    expect(String(call.messages[0]!.content)).toContain('S1 |');
    expect(call.output_config?.effort).toBe('high');
    expect(r.spend.map((s) => s.stage)).toEqual(['again']);
    expect(signs.map((s) => s.kind)).toEqual(['compose', 'seal']);
  });

  it('rebuilds a phase A ledger from its dossiers and the pages its road cites', async () => {
    const first = await firstRoad();
    const { notes, gaps, dossiers } = first.ledger!;
    const client = new FakeClient({ compose: [json(goodDraft())] });
    const r = await claudeMind(config(), { client }).draw(
      { ...WISH, weighing: WEIGHING },
      CTX,
      { task: 'again', ledger: { notes, gaps, dossiers }, earlier: EARLIER, sources: first.road.sources },
      () => undefined,
      new AbortController().signal,
    );
    expect(r.kind).toBe('road');
    expect(client.of('road')).toHaveLength(0);
  });

  it('sends the scouts again when a phase A ledger cannot be read back', async () => {
    const client = new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(goodDraft())] });
    const r = await claudeMind(config(), { client }).draw(
      { ...WISH, weighing: WEIGHING },
      CTX,
      { task: 'quest', ledger: { notes: [], gaps: [] }, earlier: [], sources: [] },
      () => undefined,
      new AbortController().signal,
    );
    expect(r.kind).toBe('road');
    expect(client.of('road')).toHaveLength(1);
    expect(client.of('keepers')).toHaveLength(1);
  });
});

describe('a deeper ask', () => {
  it('sends a short DEEPER scout, joins its findings to the ledger and returns a checked answer', async () => {
    const first = await castWith(new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(goodDraft())] })).run();
    if (first.kind !== 'road') throw new Error(first.kind);
    const question = 'I’m 34. Too late?';
    // stageOf reads a DEEPER scout as `keepers` and the deeper answer as `compose`.
    const client = new FakeClient({ keepers: [deeperScoutReply], compose: [json(goodAnswer(question))] });
    const signs: LoracleSign[] = [];
    const r = await claudeMind(config(), { client }).deeper(
      {
        wish: { ...WISH, weighing: WEIGHING },
        ledger: first.ledger!,
        sources: [],
        focus: {
          quest: {
            title: 'The Orange Boats',
            calling: 'Find Sigrún.',
            waypoints: [{ position: 0, name: 'The Open Evening', place: 'Storm Harbour Rescue Team', when: 'Wednesday' }],
          },
          waypoint: {
            position: 0,
            name: 'The Open Evening',
            when: 'Wednesday at 20:00',
            place: 'Storm Harbour Rescue Team',
            town: 'Reykjavík',
            country: 'Iceland',
            clue: 'Orange boats stacked by the door.',
            trial: 'Come to the open evening.',
            person: { name: 'Sigrún Hafsteinsdóttir', role: 'recruit leader' },
            mystery: null,
            steps: ['The open evening starts Wednesday at 20:00.'],
          },
          question,
        },
      },
      CTX,
      (s) => signs.push(s),
      new AbortController().signal,
    );
    if (r.kind !== 'answer') throw new Error(r.kind);
    expect(r.rough).toBe(false);
    expect(r.found.map((n) => n.id)).toEqual(['N8']);
    expect(r.answer.answer).toMatchObject({ keeper: { name: 'Sigrún Hafsteinsdóttir' }, unknown: 'Which night the team first calls its recruits out.' });
    expect(r.answer.answer.answer).toMatch(/Sigrún/);
    const winter = r.answer.sources.findIndex((s) => s.url === 'https://stormharbour.is/winter') + 1;
    expect(winter).toBeGreaterThan(0);
    expect(r.answer.answer.steps.at(-1)!.mark!.sources).toEqual([winter]);
    const scout = client.of('keepers')[0]!.params;
    expect(String(scout.messages[0]!.content)).toContain('ROLE: DEEPER');
    expect(scout.output_config?.effort).toBe('low');
    expect(scout.tools?.map((tool) => ('max_uses' in tool ? tool.max_uses : null))).toEqual([3, 1]);
    const answer = client.of('compose')[0]!.params;
    expect((answer.system as { text: string }[]).map((b) => b.text)).toEqual([COMPOSE_PROMPT, DEEPER_ADDENDUM]);
    expect(answer.output_config?.effort).toBe('medium');
    expect(String(answer.messages[0]!.content)).toContain(`<question>${question}</question>`);
    expect(r.spend.map((s) => s.stage)).toEqual(['deeper-scout', 'deeper']);
    expect(signs.map((s) => s.kind)).toEqual(expect.arrayContaining(['search', 'compose', 'seal']));
    expect(JSON.stringify(scout)).toContain(ANON);
  });

  /** The same ask on the Open Evening, with the reply scripts given. */
  async function askWith(question: string | null, script: ConstructorParameters<typeof FakeClient>[0]) {
    const first = await castWith(new FakeClient({ road: [roadReply], keepers: [keepersReply], compose: [json(goodDraft())] })).run();
    if (first.kind !== 'road') throw new Error(first.kind);
    const client = new FakeClient(script);
    const run = () =>
      claudeMind(config(), { client }).deeper(
        {
          wish: { ...WISH, weighing: WEIGHING },
          ledger: first.ledger!,
          sources: [],
          focus: {
            quest: { title: 'The Orange Boats', calling: 'Find Sigrún.', waypoints: [{ position: 0, name: 'The Open Evening', place: 'Storm Harbour Rescue Team', when: 'Wednesday' }] },
            waypoint: {
              position: 0,
              name: 'The Open Evening',
              when: 'Wednesday at 20:00',
              place: 'Storm Harbour Rescue Team',
              town: 'Reykjavík',
              country: 'Iceland',
              clue: 'Orange boats stacked by the door.',
              trial: 'Come to the open evening.',
              person: { name: 'Sigrún Hafsteinsdóttir', role: 'recruit leader' },
              mystery: null,
              steps: [],
            },
            question,
          },
        },
        CTX,
        () => undefined,
        new AbortController().signal,
      );
    return { client, run };
  }

  it('never shows an answer whose safety fault outlives the repair; a repair that clears it is shown', async () => {
    const question = 'I’m 34. Too late?';
    const pester = goodAnswer(question);
    pester.steps[1] = { kind: 'do', text: 'Ask Sigrún Hafsteinsdóttir again and again until she takes you in.', noteIds: ['N5'] };
    const stuck = await askWith(question, { keepers: [deeperScoutReply], compose: [json(pester)], repair: [json(pester)] });
    await expect(stuck.run()).rejects.toBeInstanceOf(MindError);
    expect(String(stuck.client.of('repair')[0]!.params.messages[0]!.content)).toContain('never again and again');
    const fixed = await askWith(question, { keepers: [deeperScoutReply], compose: [json(pester)], repair: [json(goodAnswer(question))] });
    const r = await fixed.run();
    expect(r.kind).toBe('answer');
  });

  it('sends nothing for a question at the care floor', async () => {
    const { client, run } = await askWith('Too late? I want to kill myself.', { keepers: [deeperScoutReply], compose: [json(goodAnswer(null))] });
    expect(await run()).toMatchObject({ kind: 'silent', spend: [] });
    expect(client.calls).toHaveLength(0);
  });
});

describe('the batch form of a request', () => {
  it('drops betas, fallbacks and stream, and keeps everything else', () => {
    const live = composeParams({ model: 'claude-opus-5-5', effort: config().effort }, 'turn', ANON, {
      effort: 'high',
      maxTokens: 32_000,
      addendum: AGAIN_ADDENDUM,
    });
    const batch = batchParams(live) as unknown as Record<string, unknown>;
    expect(batch).not.toHaveProperty('betas');
    expect(batch).not.toHaveProperty('fallbacks');
    expect(batch).not.toHaveProperty('stream');
    expect(batch).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 32_000, metadata: { user_id: ANON }, output_config: { effort: 'high' } });
    expect(live).toHaveProperty('fallbacks', 'default');
  });

  it('prices a batch reply at half the token rates, searches at full', () => {
    const m = msg([text('x')], 'end_turn', { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } });
    expect(spendOf('road', 'ok', m, 'claude-opus-5-5', 0, null, { batch: true }).costMicros).toBe(7_000 + 10_000);
    expect(spendOf('road', 'ok', m, 'claude-opus-5-5', 0, null).costMicros).toBe(14_000 + 10_000);
  });
});
