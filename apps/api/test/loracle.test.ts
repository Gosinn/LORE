// The Loracle's routes and jobs, with a tiny scripted mind (never the network, never Claude).
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { LORACLE_LINES, NO_LIMIT_KM, signLine, type Mark } from '#shared';
import { loracleConfig } from '../src/config.ts';
import { loracleSpend, oracleSettings, wishes, wishRoads, wishWaypoints } from '../src/db/schema.ts';
import { castsInLast24h } from '../src/lib/loracle/jobs.ts';
import { headOf } from '../src/lib/loracle/prompts.ts';
import { safeErr } from '../src/lib/safeLog.ts';
import {
  MindError,
  type CastDraft,
  type CastOptions,
  type DeeperDraft,
  type DrawFrom,
  type DraftRoad,
  type DraftWaypoint,
  type LoracleMind,
  type MindContext,
  type MindWish,
  type SignSink,
  type SpendEntry,
  type WeighedWish,
  type Weighing,
  type WeighResult,
  type WeighVerdict,
} from '../src/lib/loracle/types.ts';
import { careFloor } from '../src/lib/loracle/care.ts';
import { offerHonest, offerToken, wishKey, zonedInstant } from '../src/routes/loracle.ts';
import type { WorldData } from '../src/lib/world.ts';
import { createTestApp, quietWorld, type Client } from './helpers.ts';

// ---------------------------------------------------------------------------
// The scripted mind

const spend = (stage: SpendEntry['stage'], outcome: SpendEntry['outcome'] = 'ok', costMicros = 1000): SpendEntry => ({
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

const WEIGHING: Weighing = {
  tags: ['dangerous'],
  desire: 'SECRET-DESIRE to stand in the ring',
  binds: [],
  companion: null,
  clock: null,
  obvious: ['watch fights online'],
  terms: ['lethwei'],
  hostLanguage: 'Burmese',
  roadPlan: ['lethwei gyms yangon'],
  keeperPlan: ['lethwei trainers'],
};

const mark: Mark = { status: 'verified', year: null, sources: [1] };

const waypoint = (i: number, extra: Partial<DraftWaypoint> = {}): DraftWaypoint => ({
  kind: i === 0 ? 'door' : i === 3 ? 'summit' : 'crucible',
  emblem: 'fist',
  name: `Waypoint ${i}`,
  when: i === 0 ? 'this week' : 'next spring',
  at: i === 0 ? null : '2099-03',
  where: {
    place: `Place ${i}`,
    town: 'Yangon',
    country: 'Myanmar',
    geoQuery: `Place ${i}, Yangon, Myanmar`,
    lat: null,
    lon: null,
    precision: null,
  },
  clue: `Clue ${i}`,
  lore: false,
  trial: `TRIAL-${i}`,
  person: { name: `Keeper ${i}`, role: 'trainer', verb: 'train you', mark },
  earns: `Earns ${i}`,
  mystery: i === 2 ? 'What the old trainer wants in return' : null,
  steps: [{ kind: 'do', text: `Step ${i}`, mark }],
  noteIds: ['NOTE-ID-SECRET'],
  ...extra,
});

const ROAD: DraftRoad = {
  title: 'The Ninth Limb',
  calling: 'Go to Yangon and find the man who trains champions. Do not leave until he trains you.',
  truth: null,
  span: { amount: 7, unit: 'years' },
  thisWeek: { text: 'Train three nights at the nearest Muay Thai gym.', mark: null, day: null, minutes: 60 },
  provisions: {
    coin: [{ text: 'A year of savings', mark, counsel: false }],
    papers: [],
    body: [],
    skills: [],
    tongue: [],
  },
  rule: "Never spar without a doctor's word.",
  sources: [{ n: 1, title: 'Lethwei', url: 'https://example.org/lethwei', host: 'example.org', date: '2025', opened: true }],
  waypoints: [
    waypoint(0),
    waypoint(1),
    waypoint(2),
    waypoint(3, {
      where: { place: 'The Andaman Sea', town: null, country: 'Myanmar', geoQuery: 'Andaman Sea', lat: 12.5, lon: 96.5, precision: 'sea' },
    }),
  ],
};

type CastStep = 'road' | 'fail' | 'silent' | 'block' | 'blockPaid' | 'scoutedThenTimeout';

class StubMind implements LoracleMind {
  readonly kind = 'claude' as const;
  weighs = 0;
  casts = 0;
  draws = 0;
  lastFrom: DrawFrom | null = null;
  lastContext: MindContext | null = null;
  lastWish: MindWish | null = null;
  weighFails = 0;
  verdict: (wish: MindWish) => WeighVerdict = () => ({ route: 'quest', weighing: WEIGHING });
  /** What each next cast does (default: draw the road at once). */
  plan: CastStep[] = [];
  private gates: (() => void)[] = [];

  get blocked() {
    return this.gates.length;
  }
  release() {
    this.gates.shift()?.();
  }

  async weigh(wish: MindWish, context: MindContext): Promise<WeighResult> {
    this.weighs++;
    this.lastContext = context;
    this.lastWish = wish;
    if (this.weighFails > 0) {
      this.weighFails--;
      throw new MindError('overloaded', { spend: [spend('weigh', 'error')] });
    }
    return { verdict: this.verdict(wish), spend: [spend('weigh')] };
  }

  async cast(_wish: WeighedWish, _context: MindContext, onSign: SignSink, signal: AbortSignal, opts: CastOptions = {}): Promise<CastDraft> {
    this.casts++;
    const step = this.plan.shift() ?? 'road';
    if (step === 'scoutedThenTimeout') {
      // The scouts finished (and were paid for); the compose was cut off by the job's budget.
      opts.onLedger?.({ notes: [], gaps: ['KEPT-LEDGER'], dossiers: ['KEPT-DOSSIER'], sources: [], seen: [] });
      throw new MindError('timeout', { spend: [spend('road'), spend('keepers')] });
    }
    onSign({ kind: 'search', query: 'Lethwei gyms in Yangon' });
    onSign({ kind: 'fetch', host: 'www.example.org' });
    if (step === 'block' || step === 'blockPaid') {
      // 'blockPaid': the scouts were paid for, and the mind says so a moment after the abort.
      const paid = step === 'blockPaid' ? [spend('road', 'ok', 7000), spend('keepers', 'ok', 7000)] : [];
      await new Promise<void>((resolve, reject) => {
        this.gates.push(resolve);
        signal.addEventListener(
          'abort',
          () => {
            this.gates = this.gates.filter((g) => g !== resolve);
            setTimeout(() => reject(new MindError('interrupted', { spend: paid })), 20);
          },
          { once: true },
        );
      });
    }
    if (step === 'fail') throw new MindError('error', { spend: [spend('road', 'error')] });
    if (step === 'silent') return { kind: 'silent', spend: [spend('compose', 'refusal')] };
    onSign({ kind: 'compose' });
    onSign({ kind: 'seal' });
    return {
      kind: 'road',
      road: structuredClone(ROAD),
      rough: false,
      faults: [],
      forge: { secret: 'FORGE-SECRET' },
      ledger: {
        notes: [
          { id: 'N1', kind: 'person', name: 'Keeper 0', place: 'Yangon', text: 'Trains fighters', status: 'verified', year: '2025', sources: [1] },
        ],
        gaps: ['Who keeps the summit'],
        dossiers: ['DOSSIER-SECRET'],
      },
      spend: [spend('road'), spend('compose')],
    };
  }

  // Phase B (its own tests live in loracle-b.test.ts): drawn like a cast here.
  async draw(wish: WeighedWish, context: MindContext, from: DrawFrom, onSign: SignSink, signal: AbortSignal): Promise<CastDraft> {
    this.draws++;
    this.lastFrom = from;
    return this.cast(wish, context, onSign, signal);
  }

  async deeper(): Promise<DeeperDraft> {
    return { kind: 'silent', spend: [spend('deeper', 'refusal')] };
  }
}

/** Reykjavík is in Iceland; the sea and the bare country are not on this map; everything else is in Yangon. */
const world: WorldData = {
  ...quietWorld,
  geocode: async (q) =>
    /reykjav/i.test(q)
      ? [{ label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94, country: 'IS' }]
      : /andaman/i.test(q) || q === 'Myanmar'
        ? []
        : [{ label: q, lat: 16.8, lon: 96.15, country: 'MM' }],
  // Only Iceland's towns are named at a point.
  reverse: async (lat) => (lat > 60 ? { label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94, country: 'IS' } : null),
};

const LETHWEI = 'I wish to become the Lethwei champion of the world.';
const REALM = { label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94, country: 'IS' };

let t: Awaited<ReturnType<typeof createTestApp>>;
const stub = new StubMind();

async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function lorer(name: string, opts: { consent?: boolean; realm?: boolean } = {}): Promise<Client> {
  const c = await t.signUp(name);
  if (opts.realm !== false) {
    const res = await c.put('/api/loracle/settings', {
      home: REALM,
      radiusKm: NO_LIMIT_KM,
      timeZone: 'Atlantic/Reykjavik',
      context: { age: '25-34', body: 'a bad left knee', callings: ['fighting', 'fighting'] },
    });
    expect(res.status).toBe(200);
  }
  if (opts.consent !== false) expect((await c.post('/api/loracle/consent')).status).toBe(200);
  return c;
}

const cast = (c: Client, text = LETHWEI, extra: Record<string, unknown> = {}) =>
  c.post('/api/loracle/wishes', { text, ...extra });

const idle = () => t.app.wishJobs.idle();

async function wishCount(userId: string) {
  return (await t.db.select({ id: wishes.id }).from(wishes).where(eq(wishes.userId, userId))).length;
}

/** Cast and wait for the road to be drawn; returns the wish. */
async function drawn(c: Client, text = LETHWEI) {
  const res = await cast(c, text);
  expect(res.status).toBe(202);
  await idle();
  const wish = (await c.get(`/api/loracle/wishes/${res.body.wish.id}`)).body;
  expect(wish.road.status).toBe('drawn');
  return wish;
}

beforeAll(async () => {
  t = await createTestApp({ mind: stub, world });
});
afterAll(() => t.close());

// ---------------------------------------------------------------------------

describe('small pieces', () => {
  it('finds unmistakable signs of self-harm, and not quests that merely mention them', () => {
    expect(careFloor('I wish to end my life.')).toBe(true);
    expect(careFloor('I want to die')).toBe(true);
    expect(careFloor('I don’t want to wake up')).toBe(true);
    expect(careFloor('Mig langar að deyja')).toBe(true);
    expect(careFloor('I wish I were dead')).toBe(true);
    expect(careFloor('I wish I could just disappear')).toBe(true);
    expect(careFloor('I wish I could stop existing')).toBe(true);
    expect(careFloor('Sometimes I wish I’d never been born')).toBe(true);
    expect(careFloor('There is no reason to live')).toBe(true);
    expect(careFloor('I cut myself again')).toBe(true);
    expect(careFloor('I wish to die old and happy on a mountain')).toBe(false);
    expect(careFloor('I wish to disappear into the Amazon for a year')).toBe(false);
    expect(careFloor('I wish to work in suicide prevention')).toBe(false);
    expect(careFloor(LETHWEI)).toBe(false);
  });

  it('seals the stone’s own offers, for this Lorer, this day and these words only', () => {
    const token = offerToken('secret', 'user-1', '2026-11-18', 'I wish to be free of what my ex did.');
    expect(offerHonest('secret', 'user-1', '2026-11-18', 'i wish to be FREE of what my ex  did.', token)).toBe(true);
    expect(offerHonest('secret', 'user-1', '2026-11-18', 'I wish to find where my ex lives now.', token)).toBe(false);
    expect(offerHonest('secret', 'user-2', '2026-11-18', 'I wish to be free of what my ex did.', token)).toBe(false);
    expect(offerHonest('secret', 'user-1', '2026-11-19', 'I wish to be free of what my ex did.', token)).toBe(false);
    expect(offerHonest('secret', 'user-1', '2026-11-18', 'I wish to be free of what my ex did.', undefined)).toBe(false);
  });

  it('logs a failed query without the values bound to it', () => {
    const cause = Object.assign(new Error('duplicate key value'), { code: '23505', detail: 'Key (text)=(I wish SECRET-WISH) exists' });
    const err = new DrizzleQueryError('insert into "wishes" ("text") values ($1)', ['I wish SECRET-WISH'], cause);
    const wrapped = new Error('job crashed', { cause: err });
    for (const e of [err, wrapped]) {
      const out = JSON.stringify(safeErr(e));
      expect(out).not.toContain('SECRET-WISH');
      expect(out).toContain('insert into');
      expect(out).toContain('23505');
    }
  });

  it('retells a search as the stone would say it, without the machine’s marks', () => {
    expect(signLine({ kind: 'search', query: 'Myanmar eVisa Iceland passport November 2026' })).toBe(
      'It asks the roads about Myanmar eVisa Iceland passport.',
    );
    expect(signLine({ kind: 'search', query: '"Lone Chaw" site:facebook.com -wiki OR Yangon 2025' })).toBe(
      'It asks the roads about Lone Chaw Yangon.',
    );
    expect(signLine({ kind: 'search', query: 'site:gov.is 2026' })).toBe('It asks the roads.');
  });

  it('knows the same wish in other words of punctuation and case', () => {
    expect(wishKey('I wish to sail across an ocean!')).toBe(wishKey('sail across an  OCEAN'));
    expect(wishKey('I wish to sail across an ocean')).not.toBe(wishKey('I wish to row across an ocean'));
  });

  it('puts a wall-clock time in the Lorer’s zone', () => {
    expect(zonedInstant('2026-07-01', '18:00', 'Europe/Berlin').toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(zonedInstant('2026-01-15', '18:00', 'America/New_York').toISOString()).toBe('2026-01-15T23:00:00.000Z');
    expect(zonedInstant('2026-11-21', '18:00', 'Atlantic/Reykjavik').toISOString()).toBe('2026-11-21T18:00:00.000Z');
  });
});

describe('the stone asleep', () => {
  it('sleeps without a mind: health says so, casting is refused in-world, care still answers', async () => {
    const sleepy = await createTestApp({ world });
    try {
      expect((await sleepy.app.inject({ method: 'GET', url: '/api/health' })).json().loracle).toBe('asleep');
      const c = await sleepy.signUp('dreamer');
      await c.put('/api/loracle/settings', { home: REALM });
      await c.post('/api/loracle/consent');
      const state = await c.get('/api/loracle');
      expect(state.body.mind).toBe('asleep');
      const res = await cast(c);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: 'asleep', message: LORACLE_LINES.asleep });
      const care = await cast(c, 'I wish to end my life.');
      expect(care.body.route).toBe('care');
      expect(care.body.care.crisis.number).toBe('1717');
    } finally {
      await sleepy.close();
    }
  });

  it('is awake with a mind', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json().loracle).toBe('awake');
  });
});

describe('before the first cast', () => {
  it('asks consent first, and it can be taken back', async () => {
    const c = await lorer('ari', { consent: false });
    const first = await cast(c);
    expect(first.status).toBe(403);
    expect(first.body.error.code).toBe('consent');
    await c.post('/api/loracle/consent');
    expect((await c.get('/api/loracle')).body.consented).toBe(true);
    await c.del('/api/loracle/consent');
    expect((await c.get('/api/loracle')).body.consented).toBe(false);
    expect((await cast(c)).status).toBe(403);
    expect(stub.weighs).toBe(0);
  });

  it('needs to know where the Lorer stands', async () => {
    const c = await lorer('bjarki', { realm: false });
    const res = await cast(c);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('realm');
    expect(await wishCount(c.user.id)).toBe(0);
  });

  it('keeps the stone’s questions privately and tells the mind only the town, the country and the reach', async () => {
    const c = await lorer('carla');
    const state = (await c.get('/api/loracle')).body;
    expect(state.mind).toBe('awake');
    expect(state).not.toHaveProperty('examples');
    expect(state.settings).toMatchObject({
      realm: REALM,
      radiusKm: NO_LIMIT_KM,
      timeZone: 'Atlantic/Reykjavik',
      context: { age: '25-34', body: 'a bad left knee', callings: ['fighting'], passport: null },
    });
    await drawn(c);
    const told = JSON.stringify(stub.lastContext);
    expect(stub.lastContext).toMatchObject({
      realm: { label: 'Reykjavík', country: 'IS' },
      reachKm: NO_LIMIT_KM,
      callings: ['fighting'],
      lorer: { age: '25-34', body: 'a bad left knee' },
      timeZone: 'Atlantic/Reykjavik',
    });
    expect(stub.lastContext!.anonId).toMatch(/^[0-9a-f]{32}$/);
    for (const secret of [c.user.id, c.user.username, 'carla@example.test', '64.14', '-21.94']) {
      expect(told).not.toContain(secret);
    }
  });

  it('reaches anywhere unless the Lorer says less, and never takes the old Futures’ radius', async () => {
    const c = await lorer('fjola', { realm: false });
    await c.put('/api/loracle/settings', { home: REALM, timeZone: 'Atlantic/Reykjavik' });
    // A radius the old Futures kept (a day trip) is not the Loracle's reach.
    await t.db.update(oracleSettings).set({ radiusKm: 80 }).where(eq(oracleSettings.userId, c.user.id));
    expect((await c.get('/api/loracle')).body.settings.radiusKm).toBe(NO_LIMIT_KM);
    await drawn(c);
    expect(stub.lastContext!.reachKm).toBe(NO_LIMIT_KM);
    expect(headOf(stub.lastWish!, stub.lastContext!)).toContain('Will travel: anywhere on Earth.');
    const near = await c.put('/api/loracle/settings', { radiusKm: 500 });
    expect(near.body.radiusKm).toBe(500);
    await drawn(c, 'I wish to sail a longship.');
    expect(headOf(stub.lastWish!, stub.lastContext!)).toContain('Will travel: up to 500 km from home.');
    expect((await c.put('/api/loracle/settings', { radiusKm: NO_LIMIT_KM })).body.radiusKm).toBe(NO_LIMIT_KM);
    const [row] = await t.db.select().from(oracleSettings).where(eq(oracleSettings.userId, c.user.id));
    expect(row).toMatchObject({ loracleReachKm: null, radiusKm: 80 });
  });

  it('looks up the country once for a realm set without one', async () => {
    const c = await lorer('dagur', { realm: false });
    await c.put('/api/loracle/settings', { home: { label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94 } });
    expect((await c.get('/api/loracle')).body.settings.realm.country).toBeNull();
    expect((await cast(c)).status).toBe(202);
    await idle();
    expect((await c.get('/api/loracle')).body.settings.realm.country).toBe('IS');
  });

  it('names a realm found by the device ("Near me") from its own point, never from a far place of that name', async () => {
    const near = await lorer('eyja', { realm: false });
    await near.put('/api/loracle/settings', { home: { label: 'Near me', lat: 64.14, lon: -21.94, country: null } });
    expect((await cast(near)).status).toBe(202);
    await idle();
    expect((await near.get('/api/loracle')).body.settings.realm).toMatchObject({ label: 'Reykjavík, Iceland', country: 'IS' });

    // Nothing is named at this point, and the only "Near me" the geocoder knows is half a world away.
    const lost = await lorer('frosti', { realm: false });
    await lost.put('/api/loracle/settings', { home: { label: 'Near me', lat: 10, lon: 10, country: null } });
    const res = await cast(lost);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('realm');
    expect((await lost.get('/api/loracle')).body.settings.realm).toMatchObject({ label: 'Near me', country: null });
  });
});

describe('care, riddles, reroutes and silence store nothing', () => {
  it('answers care before everything else: asleep, before consent, before a realm, at the limit', async () => {
    const heavy = ['I wish I were dead', 'I wish I could just disappear'];
    const sleepy = await createTestApp({ world });
    try {
      const c = await sleepy.signUp('hljod');
      for (const text of heavy) expect((await cast(c, text)).body.route).toBe('care');
    } finally {
      await sleepy.close();
    }
    const noConsent = await lorer('ingi', { consent: false });
    const noRealm = await lorer('jara', { realm: false });
    const atLimit = await lorer('kolla');
    const day = new Date().toISOString().slice(0, 10);
    await t.db.insert(loracleSpend).values(
      Array.from({ length: 40 }, () => ({
        userId: atLimit.user.id,
        utcDay: day,
        day,
        stage: 'compose',
        outcome: 'ok',
        model: 'test',
        ms: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costMicros: 1,
        roadId: randomUUID(),
      })),
    );
    const weighs = stub.weighs;
    for (const c of [noConsent, noRealm, atLimit]) {
      for (const text of heavy) {
        const res = await cast(c, text);
        expect(res.status).toBe(200);
        expect(res.body.route).toBe('care');
      }
    }
    expect(stub.weighs).toBe(weighs);
  });

  it('answers self-harm with the care screen before the mind is asked', async () => {
    const c = await lorer('edda');
    const weighs = stub.weighs;
    const res = await cast(c, 'I wish to end my life.');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      route: 'care',
      care: {
        crisis: { name: 'Hjálparsíminn 1717 (Red Cross)', number: '1717', hours: '24/7', text: 'web chat' },
        emergency: '112',
        more: 'https://findahelpline.com',
      },
    });
    expect(stub.weighs).toBe(weighs);
    expect(await wishCount(c.user.id)).toBe(0);
  });

  it('answers care when the weighing sees it, and keeps no one’s name on the cost', async () => {
    const c = await lorer('fanney');
    const anonymous = async () =>
      (await t.db.select({ id: loracleSpend.id }).from(loracleSpend).where(isNull(loracleSpend.userId))).length;
    const before = await anonymous();
    stub.verdict = () => ({ route: 'care' });
    try {
      const res = await cast(c, 'I wish everything would just go quiet for good');
      expect(res.body.route).toBe('care');
    } finally {
      stub.verdict = () => ({ route: 'quest', weighing: WEIGHING });
    }
    expect(await wishCount(c.user.id)).toBe(0);
    expect(await anonymous()).toBe(before + 1);
  });

  it('asks a riddle back, then casts with the answer', async () => {
    const c = await lorer('gauti');
    stub.verdict = (w) =>
      w.riddleAnswer
        ? { route: 'quest', weighing: WEIGHING }
        : { route: 'riddle', riddle: { question: 'Happy like what?', options: ['A roaring crowd', 'A quiet shore', 'A full table'] } };
    try {
      const riddle = await cast(c, 'I wanna be happy');
      expect(riddle.body).toEqual({
        route: 'riddle',
        riddle: { question: 'Happy like what?', options: ['A roaring crowd', 'A quiet shore', 'A full table'] },
      });
      expect(await wishCount(c.user.id)).toBe(0);
      const quest = await cast(c, 'I wanna be happy', { riddleAnswer: 'like a roaring crowd' });
      expect(quest.status).toBe(202);
      expect(stub.lastWish).toMatchObject({ text: 'I wanna be happy', riddleAnswer: 'like a roaring crowd' });
      expect(quest.body.wish.text).toBe('I wanna be happy — like a roaring crowd');
    } finally {
      stub.verdict = () => ({ route: 'quest', weighing: WEIGHING });
    }
    await idle();
  });

  it('reroutes harm and stays silent when the mind declines', async () => {
    const c = await lorer('hekla');
    stub.verdict = () => ({ route: 'reroute', offer: 'I wish to be free of what my ex did.' });
    try {
      const offered = (await cast(c, 'I wish I could get back at my ex')).body;
      expect(offered).toEqual({ route: 'reroute', offer: 'I wish to be free of what my ex did.', offerToken: expect.any(String) });
      // Claimed without the seal, or for other words, it is weighed as any new wish.
      await cast(c, 'I wish to find where my ex lives now and watch her house', { rerouted: true });
      expect(stub.lastWish!.rerouted).toBe(false);
      await cast(c, 'I wish to find where my ex lives now and watch her house', { rerouted: true, offerToken: offered.offerToken });
      expect(stub.lastWish!.rerouted).toBe(false);
      await cast(c, offered.offer, { rerouted: true, offerToken: offered.offerToken });
      expect(stub.lastWish!.rerouted).toBe(true);
      stub.verdict = () => ({ route: 'silent' });
      expect((await cast(c, 'I wish for something the stone will not draw')).body).toEqual({ route: 'silent' });
    } finally {
      stub.verdict = () => ({ route: 'quest', weighing: WEIGHING });
    }
    expect(await wishCount(c.user.id)).toBe(0);
  });

  it('says the fog won when the weighing fails twice, and tries once more on its own', async () => {
    const c = await lorer('ilmur');
    stub.weighFails = 2;
    const fog = await cast(c);
    expect(fog.status).toBe(503);
    expect(fog.body.error).toMatchObject({ code: 'fog', message: LORACLE_LINES.fogWeigh });
    expect(await wishCount(c.user.id)).toBe(0);
    stub.weighFails = 1;
    expect((await cast(c)).status).toBe(202);
    await idle();
  });
});

describe('a cast draws a road', () => {
  let c: Client, other: Client;
  let wish: any;

  beforeAll(async () => {
    c = await lorer('jokull');
    other = await lorer('kata');
  });

  it('writes the wish, then the job draws its scroll', async () => {
    const res = await cast(c);
    expect(res.status).toBe(202);
    expect(res.body.route).toBe('quest');
    expect(res.body.existing).toBe(false);
    expect(res.body.wish.status).toBe('listening');
    expect(['queued', 'searching']).toContain(res.body.wish.road.status);
    expect(res.body.wish.road.signs[0]).toBe(LORACLE_LINES.listening);
    await idle();

    wish = (await c.get(`/api/loracle/wishes/${res.body.wish.id}`)).body;
    expect(wish).toMatchObject({ status: 'revealed', realm: REALM.label, beyond: false, inked: 0, total: 4 });
    expect(wish.road).toMatchObject({ status: 'drawn', phase: null, attempts: 1, title: 'The Ninth Limb', rule: ROAD.rule });
    expect(wish.road.signs).toEqual([
      LORACLE_LINES.listening,
      signLine({ kind: 'search', query: 'Lethwei gyms in Yangon' }),
      signLine({ kind: 'fetch', host: 'www.example.org' }),
      signLine({ kind: 'compose' }),
      signLine({ kind: 'seal' }),
    ]);
    expect(wish.road.fog).toEqual([{ position: 2, text: 'What the old trainer wants in return' }]);
    expect(wish.road.sources).toHaveLength(1);
  });

  it('opens the first two waypoints and sends the rest sealed, without their secrets', async () => {
    const [w0, w1, w2, w3] = wish.road.map;
    expect(w0).toMatchObject({ state: 'open', trial: 'TRIAL-0', person: { name: 'Keeper 0', verb: 'train you' } });
    expect(w1).toMatchObject({ state: 'open', trial: 'TRIAL-1' });
    for (const sealed of [w2, w3]) {
      expect(sealed.state).toBe('sealed');
      for (const hidden of ['trial', 'person', 'earns', 'steps', 'links', 'note', 'inkedOn']) expect(sealed).not.toHaveProperty(hidden);
    }
    expect(w2.mystery).toBe('What the old trainer wants in return');
    const json = JSON.stringify(wish);
    for (const secret of ['TRIAL-2', 'TRIAL-3', 'Keeper 2', 'FORGE-SECRET', 'NOTE-ID-SECRET', 'noteIds', 'DOSSIER-SECRET', 'SECRET-DESIRE', 'weighing', 'ledger']) {
      expect(json).not.toContain(secret);
    }
  });

  it('draws pins: the place from the geocoder, open sea from the mind', async () => {
    const [w0, , , w3] = wish.road.map;
    expect(w0.where).toMatchObject({ lat: 16.8, lon: 96.15, precision: 'place' });
    expect(w3.where).toMatchObject({ lat: 12.5, lon: 96.5, precision: 'sea' });
  });

  it('shows it in the quest log', async () => {
    const state = (await c.get('/api/loracle')).body;
    expect(state.wishes).toEqual([
      expect.objectContaining({ id: wish.id, title: 'The Ninth Limb', seal: 'fist', status: 'revealed', inked: 0, total: 4 }),
    ]);
    expect(state.letGo).toEqual([]);
  });

  it('answers the same wish on the same day with the scroll already drawn', async () => {
    const weighs = stub.weighs;
    const again = await cast(c, 'i wish to become the LETHWEI champion of the world');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ route: 'quest', existing: true, wish: { id: wish.id } });
    expect(stub.weighs).toBe(weighs);
    expect(await wishCount(c.user.id)).toBe(1);
  });

  it('is nobody else’s business: every route answers 404 to another Lorer', async () => {
    const wp = wish.road.map[0].id;
    const roadId = wish.road.id;
    const attempts = [
      other.get(`/api/loracle/wishes/${wish.id}`),
      other.patch(`/api/loracle/wishes/${wish.id}`, { status: 'released' }),
      other.post(`/api/loracle/wishes/${wish.id}/retry`),
      other.del(`/api/loracle/wishes/${wish.id}`),
      other.post(`/api/loracle/waypoints/${wp}/unseal`),
      other.post(`/api/loracle/waypoints/${wp}/ink`),
      other.del(`/api/loracle/waypoints/${wp}/ink`),
      other.patch(`/api/loracle/waypoints/${wp}`, { note: 'mine now' }),
      other.post(`/api/loracle/waypoints/${wp}/plan`),
      other.post(`/api/loracle/waypoints/${wp}/vault`),
      other.post(`/api/loracle/waypoints/${wp}/week`, { day: '2026-12-01' }),
      other.put(`/api/loracle/waypoints/${wp}/link`, { chapterId: null }),
      other.post(`/api/loracle/roads/${roadId}/week`, { day: '2026-12-01' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect((await other.get('/api/loracle')).body.wishes).toEqual([]);
    expect((await c.get(`/api/loracle/wishes/${wish.id}`)).body.road.map[0].note).toBeNull();
  });

  it('keeps a sealed waypoint shut until the seal is broken or the one before is inked', async () => {
    const [, w1, w2, w3] = wish.road.map;
    const shut = await c.post(`/api/loracle/waypoints/${w2.id}/ink`);
    expect(shut.status).toBe(409);
    expect(shut.body.error).toMatchObject({ code: 'sealed', message: LORACLE_LINES.sealed });
    expect((await c.post(`/api/loracle/waypoints/${w2.id}/plan`)).status).toBe(409);

    const broken = (await c.post(`/api/loracle/waypoints/${w2.id}/unseal`)).body;
    expect(broken.road.map[2]).toMatchObject({ state: 'open', trial: 'TRIAL-2', person: { name: 'Keeper 2' } });
    expect(broken.road.map[3].state).toBe('sealed');

    const inked = (await c.post(`/api/loracle/waypoints/${w1.id}/ink`, { note: 'Three nights a week.' })).body;
    expect(inked.road.map[1]).toMatchObject({ state: 'inked', note: 'Three nights a week.' });
    expect(inked.road.map[1].inkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(inked.inked).toBe(1);

    const third = (await c.post(`/api/loracle/waypoints/${w2.id}/ink`, { on: '2026-11-01' })).body;
    expect(third.road.map[2]).toMatchObject({ state: 'inked', inkedOn: '2026-11-01' });
    expect(third.road.map[3]).toMatchObject({ state: 'open', trial: 'TRIAL-3' });

    // Wiping the ink doesn't seal again what was already seen.
    const wiped = (await c.del(`/api/loracle/waypoints/${w2.id}/ink`)).body;
    expect(wiped.road.map[2]).toMatchObject({ state: 'open', inkedOn: null });
    expect(wiped.road.map[3].state).toBe('open');
    expect(w3.state).toBe('sealed'); // as first drawn
  });

  it('makes a waypoint a private plan, keeps one in the vault, and puts steps in the week', async () => {
    const w0 = wish.road.map[0].id;
    const planned = await c.post(`/api/loracle/waypoints/${w0}/plan`);
    expect(planned.status).toBe(201);
    const eventId = planned.body.road.map[0].links.eventId;
    expect(eventId).toBeTruthy();
    const event = await c.get(`/api/events/${eventId}`);
    expect(event.status).toBe(200);
    expect(event.body).toMatchObject({
      title: 'Waypoint 0',
      allDay: true,
      audience: 'participants',
      myRole: 'organizer',
      locationName: 'Place 0, Yangon, Myanmar',
      timeZone: 'Atlantic/Reykjavik',
    });
    expect((await other.get(`/api/events/${eventId}`)).status).toBe(404);
    // Again: the same plan.
    expect((await c.post(`/api/loracle/waypoints/${w0}/plan`)).body.road.map[0].links.eventId).toBe(eventId);

    const vaulted = await c.post(`/api/loracle/waypoints/${w0}/vault`);
    expect(vaulted.status).toBe(201);
    const ideaId = vaulted.body.road.map[0].links.ideaId;
    const idea = await c.get(`/api/ideas/${ideaId}`);
    expect(idea.status).toBe(200);
    expect(idea.body.audience).toBe('only_me');
    expect((await other.get(`/api/ideas/${ideaId}`)).status).toBe(404);

    const week = await c.post(`/api/loracle/waypoints/${w0}/week`, { day: '2026-12-02', time: '07:30' });
    expect(week.status).toBe(200);
    const reminderId = week.body.road.map[0].links.reminderId;
    const road = await c.post(`/api/loracle/roads/${wish.road.id}/week`, { day: '2026-12-01' });
    expect(road.status).toBe(200);
    expect(road.body.road.thisWeek.reminderId).toBeTruthy();
    const notes = (await c.get('/api/notes')).body.reminders;
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reminderId, body: 'Waypoint 0: Step 0', remindAt: '2026-12-02T07:30:00.000Z' }),
        expect.objectContaining({
          id: road.body.road.thisWeek.reminderId,
          body: `The Ninth Limb: ${ROAD.thisWeek.text}`,
          remindAt: '2026-12-01T18:00:00.000Z',
        }),
      ]),
    );
    // Moving the step moves the same reminder.
    const moved = await c.post(`/api/loracle/waypoints/${w0}/week`, { day: '2026-12-03' });
    expect(moved.body.road.map[0].links.reminderId).toBe(reminderId);
  });

  it('links a chapter the Lorer can see, never someone else’s private one', async () => {
    const w0 = wish.road.map[0].id;
    const mine = (await c.post('/api/chapters', { title: 'First night at the gym', occurredOn: '2026-11-10', audience: 'only_me' })).body.id;
    const theirs = (await other.post('/api/chapters', { title: 'Secret', occurredOn: '2026-11-10', audience: 'only_me' })).body.id;
    expect((await c.put(`/api/loracle/waypoints/${w0}/link`, { chapterId: theirs })).status).toBe(404);
    const linked = await c.put(`/api/loracle/waypoints/${w0}/link`, { chapterId: mine });
    expect(linked.body.road.map[0].links.chapterId).toBe(mine);
    const unlinked = await c.put(`/api/loracle/waypoints/${w0}/link`, { chapterId: null });
    expect(unlinked.body.road.map[0].links.chapterId).toBeNull();
    const noted = await c.patch(`/api/loracle/waypoints/${w0}`, { note: 'He said come back Monday.' });
    expect(noted.body.road.map[0].note).toBe('He said come back Monday.');
  });

  it('lets a wish go, takes it up again, and calls it fulfilled', async () => {
    const released = await c.patch(`/api/loracle/wishes/${wish.id}`, { status: 'released' });
    expect(released.body.status).toBe('released');
    let state = (await c.get('/api/loracle')).body;
    expect(state.wishes).toEqual([]);
    expect(state.letGo.map((w: any) => w.id)).toEqual([wish.id]);
    expect((await c.patch(`/api/loracle/wishes/${wish.id}`, { status: 'revealed' })).body.status).toBe('revealed');
    expect((await c.patch(`/api/loracle/wishes/${wish.id}`, { status: 'fulfilled' })).body.status).toBe('fulfilled');
    state = (await c.get('/api/loracle')).body;
    expect(state.wishes.map((w: any) => w.status)).toEqual(['fulfilled']);
  });

  it('burns the scroll, and what came of it stays the Lorer’s', async () => {
    const eventId = (await c.get(`/api/loracle/wishes/${wish.id}`)).body.road.map[0].links.eventId;
    expect((await c.del(`/api/loracle/wishes/${wish.id}`)).status).toBe(200);
    expect((await c.get(`/api/loracle/wishes/${wish.id}`)).status).toBe(404);
    expect(await t.db.select().from(wishRoads).where(eq(wishRoads.wishId, wish.id))).toEqual([]);
    expect(await t.db.select().from(wishWaypoints).where(eq(wishWaypoints.wishId, wish.id))).toEqual([]);
    expect((await c.get(`/api/events/${eventId}`)).status).toBe(200);
  });
});

describe('limits', () => {
  it('lets the stone rest past the hidden limit, in words, never a number', async () => {
    const c = await lorer('lilja');
    const day = new Date().toISOString().slice(0, 10);
    await t.db.insert(loracleSpend).values(
      Array.from({ length: 10 }, () => ({
        userId: c.user.id,
        utcDay: day,
        day,
        stage: 'compose',
        outcome: 'ok',
        model: 'test',
        ms: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costMicros: 1,
      })),
    );
    const weighs = stub.weighs;
    const res = await cast(c);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ route: 'rest' });
    expect(stub.weighs).toBe(weighs);
    expect(await wishCount(c.user.id)).toBe(0);
  });

  it('writes the wish past the owner’s ceiling, and reads it at the new moon', async () => {
    const c = await lorer('magnus');
    const [ceiling] = await t.db
      .insert(loracleSpend)
      .values({
        userId: null,
        utcDay: new Date().toISOString().slice(0, 10),
        stage: 'compose',
        outcome: 'ok',
        model: 'test',
        ms: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costMicros: 150_000_000,
      })
      .returning({ id: loracleSpend.id });
    const casts = stub.casts;
    let wishId: string;
    try {
      const res = await cast(c);
      expect(res.status).toBe(202);
      expect(res.body.wish).toMatchObject({ status: 'moon', road: { status: 'queued' } });
      wishId = res.body.wish.id;
      await t.app.wishJobs.sweep();
      await idle();
      expect((await c.get(`/api/loracle/wishes/${wishId}`)).body.status).toBe('moon');
      expect(stub.casts).toBe(casts);
    } finally {
      await t.db.delete(loracleSpend).where(eq(loracleSpend.id, ceiling!.id));
    }
    await t.app.wishJobs.sweep();
    await idle();
    const woke = (await c.get(`/api/loracle/wishes/${wishId}`)).body;
    expect(woke.status).toBe('revealed');
    expect(woke.road.signs).toContain(signLine({ kind: 'moon' }));
  });

  it('counts wishes waiting for the new moon toward the hidden limit', async () => {
    const c = await lorer('askja');
    const [ceiling] = await t.db
      .insert(loracleSpend)
      .values({
        userId: null,
        utcDay: new Date().toISOString().slice(0, 10),
        stage: 'compose',
        outcome: 'ok',
        model: 'test',
        ms: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costMicros: 150_000_000,
      })
      .returning({ id: loracleSpend.id });
    const day = new Date().toISOString().slice(0, 10);
    try {
      // Ten wishes already written for the new moon (casting them would also meet the 10-a-minute
      // rate limit, which is not what this checks).
      for (let i = 0; i < 10; i++) {
        const [w] = await t.db
          .insert(wishes)
          .values({
            userId: c.user.id,
            text: `I wish to climb mountain number ${i + 1}.`,
            textKey: wishKey(`I wish to climb mountain number ${i + 1}.`),
            context: { age: null, money: null, time: null, body: null, languages: null, passport: null, callings: [] },
            realm: { label: REALM.label, country: REALM.country, radiusKm: NO_LIMIT_KM },
            timeZone: 'Atlantic/Reykjavik',
            day,
            status: 'moon',
            weighing: WEIGHING,
          })
          .returning({ id: wishes.id });
        await t.db.insert(wishRoads).values({ wishId: w!.id, n: 1, status: 'queued', signs: [] });
      }
      const weighs = stub.weighs;
      const res = await cast(c, 'I wish to climb one mountain more.');
      expect(res.body).toEqual({ route: 'rest' });
      expect(stub.weighs).toBe(weighs);
      expect(await wishCount(c.user.id)).toBe(10);
    } finally {
      await t.db.delete(wishes).where(eq(wishes.userId, c.user.id));
      await t.db.delete(loracleSpend).where(eq(loracleSpend.id, ceiling!.id));
    }
  });

  it('rests after many weighings in a day, even when none became a quest', async () => {
    const c = await lorer('katla');
    const day = new Date().toISOString().slice(0, 10);
    await t.db.insert(loracleSpend).values(
      Array.from({ length: 40 }, () => ({
        userId: c.user.id,
        utcDay: day,
        day,
        stage: 'weigh',
        outcome: 'riddle',
        model: 'test',
        ms: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costMicros: 1,
      })),
    );
    const weighs = stub.weighs;
    const res = await cast(c);
    expect(res.body).toEqual({ route: 'rest' });
    expect(stub.weighs).toBe(weighs);
  });
});

describe('when the fog wins', () => {
  it('tries once more on its own', async () => {
    const c = await lorer('nonni');
    stub.plan = ['fail'];
    const wish = await drawn(c);
    expect(wish.status).toBe('revealed');
    expect(wish.road.attempts).toBe(2);
    expect(wish.road.signs).toContain(signLine({ kind: 'retry' }));
  });

  it('keeps what the scouts found when an attempt is cut off after them: the second draws from it', async () => {
    const c = await lorer('kept');
    stub.plan = ['scoutedThenTimeout'];
    const casts = stub.casts;
    const draws = stub.draws;
    const wish = await drawn(c);
    expect(wish.status).toBe('revealed');
    expect(wish.road.attempts).toBe(2);
    // One cast (the scouts), then one draw from their ledger: the scouts were not paid for twice.
    expect(stub.casts - casts).toBe(2); // the stub's draw composes through cast()
    expect(stub.draws - draws).toBe(1);
    expect(stub.lastFrom).toMatchObject({ task: 'quest', earlier: [], ledger: { gaps: ['KEPT-LEDGER'], dossiers: ['KEPT-DOSSIER'] } });
  });

  it('does not keep a ledger past a fresh first attempt', async () => {
    const c = await lorer('fresh');
    stub.plan = ['fail'];
    const draws = stub.draws;
    const wish = await drawn(c);
    expect(wish.road.attempts).toBe(2);
    // The first attempt failed before any ledger was kept: the second casts again.
    expect(stub.draws - draws).toBe(0);
  });

  it('fades after the second failure, and the free retry draws it', async () => {
    const c = await lorer('olof');
    stub.plan = ['fail', 'fail'];
    const res = await cast(c);
    await idle();
    const faded = (await c.get(`/api/loracle/wishes/${res.body.wish.id}`)).body;
    expect(faded).toMatchObject({ status: 'faded', road: { status: 'faded', attempts: 2, phase: null } });
    const retry = await c.post(`/api/loracle/wishes/${faded.id}/retry`);
    expect(retry.status).toBe(202);
    expect(retry.body.status).toBe('listening');
    await idle();
    const wish = (await c.get(`/api/loracle/wishes/${faded.id}`)).body;
    expect(wish).toMatchObject({ status: 'revealed', road: { status: 'drawn', attempts: 1 } });
    const again = await c.post(`/api/loracle/wishes/${faded.id}/retry`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('not_faded');
  });

  it('goes silent when the mind declines to draw', async () => {
    const c = await lorer('palli');
    stub.plan = ['silent'];
    const res = await cast(c);
    await idle();
    const wish = (await c.get(`/api/loracle/wishes/${res.body.wish.id}`)).body;
    expect(wish).toMatchObject({ status: 'silent', road: { status: 'silent', map: [] } });
  });
});

describe('stale jobs', () => {
  it('ignores a late result from a run that is no longer the road’s', async () => {
    const c = await lorer('rakel');
    stub.plan = ['block'];
    const res = await cast(c);
    await until(() => stub.blocked > 0);
    // Another process took the road over (as after a restart).
    const other = randomUUID();
    await t.db.update(wishRoads).set({ runId: other }).where(eq(wishRoads.wishId, res.body.wish.id));
    stub.release();
    await idle();
    const [road] = await t.db.select().from(wishRoads).where(eq(wishRoads.wishId, res.body.wish.id));
    expect(road).toMatchObject({ runId: other, quest: null });
    expect(await t.db.select().from(wishWaypoints).where(eq(wishWaypoints.wishId, res.body.wish.id))).toEqual([]);
    const [wish] = await t.db.select().from(wishes).where(eq(wishes.id, res.body.wish.id));
    expect(wish!.status).toBe('listening');
    await c.del(`/api/loracle/wishes/${res.body.wish.id}`);
  });

  it('stops the job when the scroll is burned mid-draw, and nothing is left', async () => {
    const c = await lorer('sigga');
    stub.plan = ['block'];
    const res = await cast(c);
    await until(() => stub.blocked > 0);
    const busy = await c.patch(`/api/loracle/wishes/${res.body.wish.id}`, { status: 'released' });
    expect(busy.status).toBe(409);
    expect((await c.del(`/api/loracle/wishes/${res.body.wish.id}`)).status).toBe(200);
    await idle();
    expect(stub.blocked).toBe(0);
    expect(await wishCount(c.user.id)).toBe(0);
    expect(await t.db.select().from(wishRoads).where(eq(wishRoads.wishId, res.body.wish.id))).toEqual([]);
    // The money spent before the burn still counts, without the wish.
    const spent = await t.db
      .select()
      .from(loracleSpend)
      .where(and(eq(loracleSpend.userId, c.user.id), eq(loracleSpend.stage, 'weigh')));
    expect(spent).toHaveLength(1);
  });

  it('retries a road a dead process left behind, and fades one that already had its retry', async () => {
    const c = await lorer('tumi');
    await drawn(c);
    const stuck = async (attempts: number) => {
      const [wish] = await t.db
        .insert(wishes)
        .values({
          userId: c.user.id,
          text: `I wish to cross Greenland on skis (${attempts})`,
          textKey: randomUUID(),
          context: { age: null, money: null, time: null, body: null, languages: null, passport: null, callings: [] },
          realm: { label: REALM.label, country: 'IS', radiusKm: NO_LIMIT_KM },
          timeZone: 'Atlantic/Reykjavik',
          day: '2026-11-18',
          status: 'listening',
          weighing: WEIGHING,
        })
        .returning({ id: wishes.id });
      await t.db.insert(wishRoads).values({
        wishId: wish!.id,
        status: 'drawing',
        attempts,
        runId: randomUUID(),
        heartbeatAt: new Date(Date.now() - 10 * 60_000),
        signs: [LORACLE_LINES.listening],
      });
      return wish!.id;
    };
    const once = await stuck(1);
    const twice = await stuck(2);
    await t.app.wishJobs.sweep();
    await idle();
    const retried = (await c.get(`/api/loracle/wishes/${once}`)).body;
    expect(retried).toMatchObject({ status: 'revealed', road: { status: 'drawn', attempts: 2 } });
    expect(retried.road.signs).toContain(signLine({ kind: 'retry' }));
    const faded = (await c.get(`/api/loracle/wishes/${twice}`)).body;
    expect(faded).toMatchObject({ status: 'faded', road: { status: 'faded' } });
  });

  it('leaves a road whose job is alive alone', async () => {
    const c = await lorer('unnur');
    stub.plan = ['block'];
    const res = await cast(c);
    await until(() => stub.blocked > 0);
    await t.app.wishJobs.sweep();
    const [road] = await t.db.select().from(wishRoads).where(eq(wishRoads.wishId, res.body.wish.id));
    expect(road!.status).toBe('searching');
    stub.release();
    await idle();
    expect((await c.get(`/api/loracle/wishes/${res.body.wish.id}`)).body.status).toBe('revealed');
  });
});

describe('export and account deletion', () => {
  it('exports wishes, roads, waypoints, context and what the stone found, not its working notes', async () => {
    const c = await lorer('vala');
    await drawn(c);
    const res = await c.get('/api/me/export');
    expect(res.status).toBe(200);
    const { loracle } = res.body;
    expect(loracle.consentAt).toBeTruthy();
    expect(loracle.context).toMatchObject({ age: '25-34', callings: ['fighting'] });
    expect(loracle.wishes).toHaveLength(1);
    const [wish] = loracle.wishes;
    expect(wish).toMatchObject({ text: LETHWEI, status: 'revealed', realm: { label: REALM.label, country: 'IS' } });
    expect(wish.ledger).toEqual({
      notes: [expect.objectContaining({ id: 'N1', text: 'Trains fighters' })],
      gaps: ['Who keeps the summit'],
    });
    expect(wish.roads[0].quest.title).toBe('The Ninth Limb');
    expect(wish.roads[0].waypoints).toHaveLength(4);
    expect(loracle.spend.length).toBeGreaterThan(0);
    expect(wish.weighing).toEqual({ tags: ['dangerous'], desire: 'SECRET-DESIRE to stand in the ring', binds: [], companion: null, clock: null });
    const json = JSON.stringify(loracle);
    for (const secret of ['FORGE-SECRET', 'DOSSIER-SECRET', 'NOTE-ID-SECRET', 'lethwei gyms yangon', 'lethwei trainers', 'watch fights online']) {
      expect(json).not.toContain(secret);
    }
  });

  it('removes every wish with the account, even one still being drawn; the cost rows lose their owner', async () => {
    const c = await lorer('ylfa');
    await drawn(c);
    stub.plan = ['block'];
    await cast(c, 'I wish to sail across an ocean.');
    await until(() => stub.blocked > 0);
    const spendBefore = (await t.db.select().from(loracleSpend)).length;
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { cookie: c.cookie },
      payload: { password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    await idle();
    expect(stub.blocked).toBe(0);
    expect(await wishCount(c.user.id)).toBe(0);
    expect(await t.db.select().from(loracleSpend).where(eq(loracleSpend.userId, c.user.id))).toEqual([]);
    expect((await t.db.select().from(loracleSpend)).length).toBeGreaterThanOrEqual(spendBefore);
  });
});

describe('what bounds the owner’s money', () => {
  const day = () => new Date().toISOString().slice(0, 10);
  const ceilingRow = (micros: number) => ({
    userId: null,
    utcDay: day(),
    stage: 'compose',
    outcome: 'ok',
    model: 'test',
    ms: 1,
    inputTokens: 1,
    outputTokens: 1,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costMicros: micros,
  });

  it('weighs nothing far past the monthly ceiling, and stores nothing', async () => {
    const c = await lorer('lara');
    const [row] = await t.db.insert(loracleSpend).values(ceilingRow(170_000_000)).returning({ id: loracleSpend.id });
    const weighs = stub.weighs;
    try {
      const res = await cast(c);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ route: 'moon' });
      expect(stub.weighs).toBe(weighs);
      expect(await wishCount(c.user.id)).toBe(0);
      // Care still answers.
      expect((await cast(c, 'I wish I were dead')).body.route).toBe('care');
    } finally {
      await t.db.delete(loracleSpend).where(eq(loracleSpend.id, row!.id));
    }
  });

  it('counts every weighing asked for, care included, even when nothing of it is kept', async () => {
    const config = loracleConfig({ anonSalt: 'x' });
    config.weighsPer24h = 2;
    const mind = new StubMind();
    mind.verdict = () => ({ route: 'care' });
    const small = await createTestApp({ mind, world, config: { loracle: config } });
    try {
      const c = await small.signUp('maria');
      await c.put('/api/loracle/settings', { home: REALM, timeZone: 'Atlantic/Reykjavik' });
      await c.post('/api/loracle/consent');
      expect((await cast(c, 'I wish everything would go quiet')).body.route).toBe('care');
      expect((await cast(c, 'I wish the noise would stop for good')).body.route).toBe('care');
      expect((await cast(c, 'I wish for a quiet that lasts')).body).toEqual({ route: 'rest' });
      expect(mind.weighs).toBe(2);
    } finally {
      await small.close();
    }
  });

  it('records what a burned cast already paid for, and burning never refunds the hidden limit', async () => {
    const c = await lorer('nanna');
    stub.plan = ['blockPaid'];
    const res = await cast(c);
    await until(() => stub.blocked > 0);
    expect((await c.del(`/api/loracle/wishes/${res.body.wish.id}`)).status).toBe(200);
    await idle();
    const paid = await t.db
      .select({ stage: loracleSpend.stage, roadId: loracleSpend.roadId })
      .from(loracleSpend)
      .where(and(eq(loracleSpend.userId, c.user.id), eq(loracleSpend.stage, 'road')));
    expect(paid).toHaveLength(1);
    expect(paid[0]!.roadId).toBeTruthy();
    expect(await castsInLast24h(t.db, c.user.id)).toBe(1);
  });

  it('gives a faded road one free “Try again” a day, and only while the stone may read', async () => {
    const c = await lorer('oddny');
    stub.plan = ['fail', 'fail'];
    const res = await cast(c);
    await idle();
    const id = res.body.wish.id;
    expect((await c.get(`/api/loracle/wishes/${id}`)).body.status).toBe('faded');
    stub.plan = ['fail', 'fail'];
    expect((await c.post(`/api/loracle/wishes/${id}/retry`)).status).toBe(202);
    await idle();
    expect((await c.get(`/api/loracle/wishes/${id}`)).body.status).toBe('faded');
    const again = await c.post(`/api/loracle/wishes/${id}/retry`);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'retried', message: LORACLE_LINES.retried });
    // Tomorrow it may try again, but not for a Lorer who stopped sending wishes.
    await t.db.update(wishRoads).set({ retriedOn: '2000-01-01' }).where(eq(wishRoads.wishId, id));
    await c.del('/api/loracle/consent');
    const casts = stub.casts;
    const refused = await c.post(`/api/loracle/wishes/${id}/retry`);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('consent');
    expect(stub.casts).toBe(casts);
    // Its faded road counts once toward the hidden limit, however many times it was tried.
    expect(await castsInLast24h(t.db, c.user.id)).toBe(1);
  });
});

describe('“Stop sending wishes”', () => {
  const waiting = (userId: string, text: string, status: 'listening' | 'moon') =>
    t.db
      .insert(wishes)
      .values({
        userId,
        text,
        textKey: wishKey(text),
        context: { age: null, money: null, time: null, body: null, languages: null, passport: null, callings: [] },
        realm: { label: REALM.label, country: 'IS', radiusKm: NO_LIMIT_KM },
        timeZone: 'Atlantic/Reykjavik',
        day: '2026-11-18',
        status,
        weighing: WEIGHING,
      })
      .returning({ id: wishes.id })
      .then(async ([w]) => {
        await t.db.insert(wishRoads).values({ wishId: w!.id, n: 1, status: 'queued', signs: [] });
        return w!.id;
      });

  it('stops the road being drawn and fades every wish still waiting; the sweep never sends them', async () => {
    const c = await lorer('petra');
    const drawnWish = await drawn(c);
    stub.plan = ['block'];
    const res = await cast(c, 'I wish to cross the Vatnajökull in winter.');
    await until(() => stub.blocked > 0);
    const moon = await waiting(c.user.id, 'I wish to sail to Svalbard.', 'moon');

    expect((await c.del('/api/loracle/consent')).status).toBe(200);
    await idle();
    expect(stub.blocked).toBe(0);
    const casts = stub.casts;
    await t.app.wishJobs.sweep();
    await idle();
    expect(stub.casts).toBe(casts);
    for (const id of [res.body.wish.id, moon]) {
      expect((await c.get(`/api/loracle/wishes/${id}`)).body).toMatchObject({ status: 'faded', road: { status: 'faded' } });
    }
    // The scroll already drawn stays.
    expect((await c.get(`/api/loracle/wishes/${drawnWish.id}`)).body.status).toBe('revealed');
  });

  it('fades a queued road whose Lorer stopped sending wishes, instead of reading it', async () => {
    const c = await lorer('ragna');
    const id = await waiting(c.user.id, 'I wish to row the Atlantic.', 'listening');
    // Consent gone without the route (as if withdrawn while another server held the road).
    await t.db.update(oracleSettings).set({ loracleConsentAt: null }).where(eq(oracleSettings.userId, c.user.id));
    const casts = stub.casts;
    await t.app.wishJobs.sweep();
    await idle();
    expect(stub.casts).toBe(casts);
    expect((await c.get(`/api/loracle/wishes/${id}`)).body).toMatchObject({ status: 'faded', road: { status: 'faded' } });
  });
});

describe('the boot sweep', () => {
  it('leaves a road another process is still drawing, and takes up one that went quiet', async () => {
    const c = await lorer('sunna');
    const stuck = async (quietMs: number) => {
      const [wish] = await t.db
        .insert(wishes)
        .values({
          userId: c.user.id,
          text: `I wish to walk the Laugavegur (${quietMs})`,
          textKey: randomUUID(),
          context: { age: null, money: null, time: null, body: null, languages: null, passport: null, callings: [] },
          realm: { label: REALM.label, country: 'IS', radiusKm: NO_LIMIT_KM },
          timeZone: 'Atlantic/Reykjavik',
          day: '2026-11-18',
          status: 'listening',
          weighing: WEIGHING,
        })
        .returning({ id: wishes.id });
      await t.db.insert(wishRoads).values({
        wishId: wish!.id,
        status: 'drawing',
        attempts: 1,
        runId: randomUUID(),
        heartbeatAt: new Date(Date.now() - quietMs),
        signs: [LORACLE_LINES.listening],
      });
      return wish!.id;
    };
    const alive = await stuck(5_000);
    const quiet = await stuck(60_000);
    await t.app.wishJobs.sweep({ boot: true });
    await idle();
    const [aliveRoad] = await t.db.select().from(wishRoads).where(eq(wishRoads.wishId, alive));
    expect(aliveRoad!.status).toBe('drawing');
    expect((await c.get(`/api/loracle/wishes/${quiet}`)).body).toMatchObject({ status: 'revealed', road: { attempts: 2 } });
    await t.db.delete(wishes).where(eq(wishes.id, alive));
  });
});
