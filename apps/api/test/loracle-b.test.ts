// The Loracle, phase B: "Ask again", "Ask the stone about this" and the dawn lane (Message Batches
// and the hourly tick). A scripted mind for the live lane and a fake batches client for the dawn
// lane: never the network, never Claude.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LORACLE_LINES, NO_LIMIT_KM, signLine, type AskResult, type DeeperView, type LoracleState, type Wish } from '#shared';
import { loadConfig, loracleConfig } from '../src/config.ts';
import { loracleSpend, wishAsks, wishes, wishRoads } from '../src/db/schema.ts';
import { createDawnLane } from '../src/lib/loracle/dawn.ts';
import { castsInLast24h } from '../src/lib/loracle/jobs.ts';
import { AGAIN_ADDENDUM, COMPOSE_PROMPT } from '../src/lib/loracle/prompts.ts';
import type { RoadDawnState } from '../src/lib/loracle/types.ts';
import type { WorldData } from '../src/lib/world.ts';
import { createTestApp, quietWorld, type Client } from './helpers.ts';
import { FakeBatches, PhaseMind, STORM_WEIGHING, STORM_WISH, pausedReply } from './loracleFixtures.ts';

const REALM = { label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94, country: 'IS' };
const SECRET = 'a-tick-secret-for-tests-only-0123456789';
const HOUR = 60 * 60 * 1000;
const DAWN_CONFIG = loracleConfig({ anonSalt: 'test-salt', castsNow: 1, deeperNow: 1, tickSecret: SECRET });
const world: WorldData = {
  ...quietWorld,
  geocode: async (q) => [{ label: q, lat: 64.1, lon: -21.9, country: 'IS' }],
  reverse: async () => ({ label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94, country: 'IS' }),
};

type App = Awaited<ReturnType<typeof createTestApp>>;
let t: App; // the live lane only (no tick secret: the dawn lane is off)
let d: App; // the dawn lane on: one cast and one ask a day at once, the rest at dawn
const mind = new PhaseMind();
const dawnMind = new PhaseMind();
const batches = new FakeBatches();

beforeAll(async () => {
  t = await createTestApp({ mind, world });
  d = await createTestApp({
    mind: dawnMind,
    world,
    batches,
    config: { loracle: DAWN_CONFIG },
  });
});
afterAll(async () => {
  await t.close();
  await d.close();
});

let names = 0;
async function lorer(app: App, name = `lorer${++names}`): Promise<Client> {
  const c = await app.signUp(name);
  expect((await c.put('/api/loracle/settings', { home: REALM, radiusKm: NO_LIMIT_KM, timeZone: 'Atlantic/Reykjavik' })).status).toBe(200);
  expect((await c.post('/api/loracle/consent')).status).toBe(200);
  return c;
}

const cast = (c: Client, text = STORM_WISH) => c.post<{ route: string; wish: Wish }>('/api/loracle/wishes', { text });

async function drawn(app: App, c: Client, text = STORM_WISH): Promise<Wish> {
  const res = await cast(c, text);
  expect(res.status).toBe(202);
  await app.app.wishJobs.idle();
  const wish = (await c.get<Wish>(`/api/loracle/wishes/${res.body.wish.id}`)).body;
  expect(wish.road.status).toBe('drawn');
  return wish;
}

const tick = (app: App, secret: string | null = SECRET) =>
  app.app.inject({ method: 'POST', url: '/api/loracle/tick', headers: secret ? { authorization: `Bearer ${secret}` } : {} });

/**
 * Tick until `done` holds (at most `n` ticks), letting the jobs settle between ticks. Through the route
 * (its rate limit is 30 a minute), or straight on the lane (`lane`) in tests that tick many times.
 */
async function tickUntil(done: () => Promise<boolean>, n = 8, via: 'route' | 'lane' = 'route') {
  for (let i = 0; i < n; i++) {
    if (via === 'route') expect((await tick(d)).statusCode).toBe(200);
    else await d.app.dawn.tick();
    await d.app.wishJobs.idle();
    if (await done()) return;
  }
  throw new Error('the dawn lane never finished');
}

const roadRow = async (app: App, roadId: string) => (await app.db.select().from(wishRoads).where(eq(wishRoads.id, roadId)))[0]!;

/**
 * Cast for dawn, its promise moved well away from now: the Lorer's next 06:00 may be within the
 * promise keeper's three hours when the tests run, and only the promise test wants that.
 */
async function castForDawn(c: Client, text = STORM_WISH) {
  const res = await cast(c, text);
  expect(res.body.wish.road.lane).toBe('dawn');
  await d.db.update(wishRoads).set({ dueBy: new Date(Date.now() + 20 * 60 * 60 * 1000) }).where(eq(wishRoads.id, res.body.wish.road.id));
  return res;
}

/** Ask for dawn, its promise moved away likewise. */
async function askForDawn(c: Client, waypointId: string, body: object = {}) {
  const res = await c.post<DeeperView>(`/api/loracle/waypoints/${waypointId}/ask`, body);
  expect(res.body.status).toBe('dawn');
  await d.db.update(wishAsks).set({ dueBy: new Date(Date.now() + 20 * 60 * 60 * 1000) }).where(eq(wishAsks.id, res.body.id));
  return res;
}

// ---------------------------------------------------------------------------

describe('config', () => {
  it('has the soft budget’s defaults, keeps the tick secret out of sight, and refuses a short one', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect(c.loracle).toMatchObject({ castsNow: 3, deeperNow: 10, dailyBudgetUsd: 10, asksPer24h: 30 });
    expect(c.loracle.tickSecret).toBeUndefined();
    const on = loadConfig({ NODE_ENV: 'test', LORACLE_TICK_SECRET: SECRET, LORACLE_CASTS_NOW: '2' });
    expect(on.loracle.tickSecret).toBe(SECRET);
    expect(on.loracle.castsNow).toBe(2);
    expect(JSON.stringify(on)).not.toContain(SECRET);
    expect(() => loadConfig({ NODE_ENV: 'test', LORACLE_TICK_SECRET: 'too-short' })).toThrow(/LORACLE_TICK_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'test', LORACLE_CASTS_NOW: '-1' })).toThrow();
    expect(loadConfig({ NODE_ENV: 'test', LORACLE_TICK_SECRET: '  ' }).loracle.tickSecret).toBeUndefined();
  });
});

describe('Ask again', () => {
  it('draws another road from the same ledger, without the scouts, and keeps both', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c);
    const casts = mind.casts;
    const res = await c.post<Wish>(`/api/loracle/wishes/${wish.id}/again`);
    expect(res.status).toBe(202);
    expect(res.body.roads.map((r) => r.n)).toEqual([1, 2]);
    await t.app.wishJobs.idle();
    const after = (await c.get<Wish>(`/api/loracle/wishes/${wish.id}`)).body;
    expect(after.status).toBe('revealed');
    expect(after.roads[1]).toMatchObject({ n: 2, status: 'drawn', lane: 'now', title: 'Another Road 2' });
    expect(after.road.title).toBe('The First Road');
    expect(mind.casts).toBe(casts); // no scouts
    expect(mind.lastFrom).toMatchObject({ task: 'again', earlier: [{ title: 'The First Road', keepers: expect.arrayContaining(['Keeper 0']) }] });
    expect(mind.lastFrom!.ledger.notes[0]!.id).toBe('N1');
    // It counts as a cast: toward the hidden limit, with its own spend rows.
    expect(await castsInLast24h(t.db, c.user.id)).toBe(2);
    const rows = await t.db.select().from(loracleSpend).where(and(eq(loracleSpend.roadId, after.roads[1]!.id), eq(loracleSpend.stage, 'again')));
    expect(rows).toHaveLength(1);
  });

  it('waits for a road to be drawn, one road at a time, and only for the Lorer', async () => {
    const c = await lorer(t);
    mind.castPlan = ['block'];
    const res = await cast(c, 'I wish to sail with the rescue boats.');
    await expect.poll(() => mind.blocked).toBe(1);
    const id = res.body.wish.id;
    const early = await c.post(`/api/loracle/wishes/${id}/again`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('in_progress');
    mind.release();
    await t.app.wishJobs.idle();
    const stranger = await lorer(t);
    expect((await stranger.post(`/api/loracle/wishes/${id}/again`)).status).toBe(404);
    mind.drawPlan = ['block'];
    expect((await c.post(`/api/loracle/wishes/${id}/again`)).status).toBe(202);
    await expect.poll(() => mind.blocked).toBe(1);
    expect((await c.post(`/api/loracle/wishes/${id}/again`)).body.error.code).toBe('in_progress');
    mind.release();
    await t.app.wishJobs.idle();
  });

  it('fades on its own after two failures, and the free retry draws it again', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to keep the night watch.');
    mind.drawPlan = ['fail', 'fail'];
    await c.post(`/api/loracle/wishes/${wish.id}/again`);
    await t.app.wishJobs.idle();
    let after = (await c.get<Wish>(`/api/loracle/wishes/${wish.id}`)).body;
    expect(after.status).toBe('revealed'); // the wish keeps its drawn road
    expect(after.roads[1]).toMatchObject({ status: 'faded', attempts: 2 });
    expect((await c.post(`/api/loracle/wishes/${wish.id}/retry`)).status).toBe(202);
    await t.app.wishJobs.idle();
    after = (await c.get<Wish>(`/api/loracle/wishes/${wish.id}`)).body;
    expect(after.roads[1]!.status).toBe('drawn');
  });

  it('rests past the hidden limit, and asks no mind', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to learn the rope rescue.');
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
    const draws = mind.draws;
    const res = await c.post(`/api/loracle/wishes/${wish.id}/again`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'rest', message: LORACLE_LINES.rest });
    expect(mind.draws).toBe(draws);
  });
});

describe('Ask the stone about this', () => {
  it('pins an answer to an open waypoint, counts what it cost, and shows it to the Lorer only', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to join the storm team.');
    const wp = wish.road.map[0]!;
    const res = await c.post<DeeperView>(`/api/loracle/waypoints/${wp.id}/ask`, { question: "I'm 34. Too late?" });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'listening', lane: 'now', question: "I'm 34. Too late?", answer: null });
    await t.app.wishJobs.idle();
    const after = (await c.get<Wish>(`/api/loracle/wishes/${wish.id}`)).body;
    const open = after.road.map[0]!;
    if (open.state === 'sealed') throw new Error('sealed');
    expect(open.asks).toHaveLength(1);
    expect(open.asks[0]).toMatchObject({ status: 'answered', answer: { answer: 'Others came older and stayed.', words: 'I came to train.' } });
    expect(open.asks[0]!.answer!.steps).toHaveLength(3);
    expect(open.asks[0]!.sources[0]!.url).toBe('https://stormharbour.is/winter');
    expect(open.asks[0]!.signs).toContain(signLine({ kind: 'seal' }));
    expect(mind.lastAsk!.focus).toMatchObject({ question: "I'm 34. Too late?", waypoint: { name: 'Waypoint 0', position: 0 } });
    // The mind is never told who asks.
    expect(JSON.stringify(mind.lastAsk)).not.toContain(c.user.username);
    const rows = await t.db.select().from(loracleSpend).where(eq(loracleSpend.askId, res.body.id));
    expect(rows.map((r) => r.stage).sort()).toEqual(['deeper', 'deeper-scout']);
  });

  it('keeps a sealed waypoint shut, asks one thing at a time, and is the Lorer’s alone', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to find the fjord’s search drills.');
    const sealed = wish.road.map[2]!;
    expect(sealed.state).toBe('sealed');
    const shut = await c.post(`/api/loracle/waypoints/${sealed.id}/ask`, {});
    expect(shut.status).toBe(409);
    expect(shut.body.error.code).toBe('sealed');
    const wp = wish.road.map[1]!;
    mind.deeperPlan = ['block'];
    expect((await c.post(`/api/loracle/waypoints/${wp.id}/ask`, {})).status).toBe(202);
    await expect.poll(() => mind.blocked).toBe(1);
    const again = await c.post(`/api/loracle/waypoints/${wp.id}/ask`, {});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'in_progress', message: LORACLE_LINES.askBusy });
    mind.release();
    await t.app.wishJobs.idle();
    const stranger = await lorer(t);
    expect((await stranger.post(`/api/loracle/waypoints/${wp.id}/ask`, {})).status).toBe(404);
  });

  it('retries once, then fades; a declined ask is silent', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to carry the stretcher.');
    mind.deeperPlan = ['fail', 'fail'];
    const faded = await c.post<DeeperView>(`/api/loracle/waypoints/${wish.road.map[0]!.id}/ask`, {});
    await t.app.wishJobs.idle();
    const [row] = await t.db.select().from(wishAsks).where(eq(wishAsks.id, faded.body.id));
    expect(row).toMatchObject({ status: 'faded', attempts: 2 });
    expect(row!.signs).toContain(signLine({ kind: 'retry' }));
    mind.deeperPlan = ['silent'];
    const silent = await c.post<DeeperView>(`/api/loracle/waypoints/${wish.road.map[1]!.id}/ask`, {});
    await t.app.wishJobs.idle();
    expect((await t.db.select().from(wishAsks).where(eq(wishAsks.id, silent.body.id)))[0]!.status).toBe('silent');
  });

  it('answers a question at the care floor with the care screen: nothing stored, nothing sent', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to swim the cold harbour.');
    const deepers = mind.deepers;
    const res = await c.post<AskResult>(`/api/loracle/waypoints/${wish.road.map[0]!.id}/ask`, { question: 'Too late? I want to kill myself.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ route: 'care', care: { more: expect.any(String) } });
    await t.app.wishJobs.idle();
    expect(await t.db.select().from(wishAsks).where(eq(wishAsks.wishId, wish.id))).toEqual([]);
    expect(mind.deepers).toBe(deepers);
  });

  it('takes one ask a waypoint, even from a double tap', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to steer the rescue boat.');
    const wp = wish.road.map[0]!.id;
    mind.deeperPlan = ['block'];
    const [a, b] = await Promise.all([c.post(`/api/loracle/waypoints/${wp}/ask`, {}), c.post(`/api/loracle/waypoints/${wp}/ask`, {})]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect((a.status === 409 ? a : b).body.error).toMatchObject({ code: 'in_progress', message: LORACLE_LINES.askBusy });
    expect(await t.db.select().from(wishAsks).where(eq(wishAsks.waypointId, wp))).toHaveLength(1);
    await expect.poll(() => mind.blocked).toBe(1);
    mind.release();
    await t.app.wishJobs.idle();
  });

  it('picks up an ask a restart cut off: the sweep tries it once more, and fades one already tried twice', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to hold the line on the cliff.');
    const day = new Date().toISOString().slice(0, 10);
    const quiet = new Date(Date.now() - 10 * 60 * 1000); // no heartbeat for ten minutes: its run is gone
    const base = { wishId: wish.id, userId: c.user.id, day, status: 'listening' as const, lane: 'now' as const, heartbeatAt: quiet };
    const [cut, tired] = await t.db
      .insert(wishAsks)
      .values([
        { ...base, waypointId: wish.road.map[0]!.id, question: 'Too late?', runId: randomUUID(), attempts: 1 },
        { ...base, waypointId: wish.road.map[1]!.id, runId: randomUUID(), attempts: 2 },
      ])
      .returning();
    const deepers = mind.deepers;
    await t.app.wishJobs.sweep();
    await t.app.wishJobs.idle();
    const row = async (id: string) => (await t.db.select().from(wishAsks).where(eq(wishAsks.id, id)))[0]!;
    expect(await row(cut!.id)).toMatchObject({ status: 'answered', attempts: 2 });
    expect((await row(cut!.id)).signs).toContain(signLine({ kind: 'retry' }));
    expect(await row(tired!.id)).toMatchObject({ status: 'faded', failure: 'interrupted', runId: null });
    expect(mind.deepers).toBe(deepers + 1);
    expect(mind.lastAsk!.focus.question).toBe('Too late?');
  });

  it('rests past the hidden limit on asks', async () => {
    const c = await lorer(t);
    const wish = await drawn(t, c, 'I wish to read the weather like the team.');
    const wp = wish.road.map[0]!;
    const day = new Date().toISOString().slice(0, 10);
    await t.db.insert(wishAsks).values(
      Array.from({ length: 30 }, () => ({ waypointId: wp.id, wishId: wish.id, userId: c.user.id, day, status: 'answered' as const })),
    );
    const res = await c.post(`/api/loracle/waypoints/${wp.id}/ask`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('rest');
  });
});

describe('the dawn lane', () => {
  it('writes a cast past the soft budget for dawn: never a refusal, never a number', async () => {
    const c = await lorer(d);
    await drawn(d, c, 'I wish to stand the first watch.');
    const casts = dawnMind.casts;
    const res = await castForDawn(c);
    expect(res.status).toBe(202);
    expect(res.body.route).toBe('quest');
    expect(res.body.wish.status).toBe('listening');
    expect(res.body.wish.road).toMatchObject({ lane: 'dawn', status: 'queued' });
    expect(new Date(res.body.wish.road.dueBy!).getTime()).toBeGreaterThan(Date.now());
    await d.app.wishJobs.idle();
    expect(dawnMind.casts).toBe(casts);
    // The quest log says it waits for dawn (LORACLE_LINES.logDawn), still without a number.
    const log = (await c.get<LoracleState>('/api/loracle')).body.wishes;
    expect(log.find((w) => w.id === res.body.wish.id)).toMatchObject({ status: 'listening', lane: 'dawn' });
    expect(log.find((w) => w.id !== res.body.wish.id)).toMatchObject({ status: 'revealed', lane: 'now' });
  });

  it('answers the tick only with the secret (404 otherwise, and 404 where none is set)', async () => {
    expect((await tick(d, null)).statusCode).toBe(404);
    expect((await tick(d, 'a-wrong-secret-that-is-long-enough-000')).statusCode).toBe(404);
    expect((await tick(t, SECRET)).statusCode).toBe(404);
    const ok = await tick(d);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ collected: expect.any(Number), submitted: expect.any(Number), live: expect.any(Number), waiting: expect.any(Number) });
  });

  it('draws a dawn road through batches at half price, as the live lane would, and a second tick finds nothing to do', async () => {
    await d.app.wishJobs.idle();
    await tickUntil(async () => (await d.db.select().from(wishRoads).where(eq(wishRoads.lane, 'dawn'))).every((r) => r.status === 'drawn'));
    const [road] = await d.db.select().from(wishRoads).where(eq(wishRoads.lane, 'dawn'));
    const [wish] = await d.db.select().from(wishes).where(eq(wishes.id, road!.wishId));
    expect(wish!.status).toBe('revealed');
    expect(road!.quest!.title).toBe('The Orange Boats');
    expect(road!.batch).toBeNull();
    expect(road!.signs).toContain(signLine({ kind: 'dawn' }));
    expect(road!.signs).toContain(signLine({ kind: 'seal' }));
    expect(wish!.ledger!.sources!.length).toBeGreaterThan(0); // the whole ledger is kept for later asks
    const parts = batches.sent().map((s) => s.part);
    expect(parts).toEqual(expect.arrayContaining(['road', 'keepers', 'compose']));
    // Half price: 1000 in at $4/MTok and 500 out at $20/MTok, halved, plus one search at $0.01.
    const scouts = await d.db.select().from(loracleSpend).where(and(eq(loracleSpend.roadId, road!.id), eq(loracleSpend.stage, 'road')));
    expect(scouts).toHaveLength(1);
    expect(scouts[0]).toMatchObject({ lane: 'dawn', costMicros: 7_000 + 10_000 });
    const again = (await tick(d)).json();
    expect(again).toMatchObject({ collected: 0, submitted: 0, live: 0 });
  });

  it('answers a deeper ask past the soft budget at dawn, from the kept ledger and its own search', async () => {
    const c = await lorer(d);
    // A road drawn at dawn keeps the whole ledger: cast once now, once for dawn, and draw it.
    await drawn(d, c, 'I wish to light the hall’s lamps.');
    const res = await castForDawn(c);
    await tickUntil(async () => (await roadRow(d, res.body.wish.road.id)).status === 'drawn');
    const wish = (await c.get<Wish>(`/api/loracle/wishes/${res.body.wish.id}`)).body;
    const [w0, w1] = wish.road.map;
    // The first ask of the day is answered at once (the scripted mind); the next one waits for dawn.
    await c.post(`/api/loracle/waypoints/${w0!.id}/ask`, {});
    await d.app.wishJobs.idle();
    const late = await askForDawn(c, w1!.id, { question: "I'm 34. Too late?" });
    expect(late.body).toMatchObject({ status: 'dawn', lane: 'dawn' });
    await tickUntil(async () => (await d.db.select().from(wishAsks).where(eq(wishAsks.id, late.body.id)))[0]!.status === 'answered');
    const after = (await c.get<Wish>(`/api/loracle/wishes/${wish.id}`)).body;
    const lit = after.road.map[1]!;
    if (lit.state === 'sealed') throw new Error('sealed');
    const ask = lit.asks.find((a) => a.id === late.body.id)!;
    expect(ask.answer).toMatchObject({ keeper: { name: 'Sigrún Hafsteinsdóttir' }, unknown: 'Which night the team first calls its recruits out.' });
    expect(ask.answer!.answer).toMatch(/Sigrún/);
    expect(ask.answer!.steps).toHaveLength(3);
    expect(ask.sources.map((s) => s.url)).toContain('https://stormharbour.is/winter');
    expect(batches.sent().map((s) => s.part)).toEqual(expect.arrayContaining(['deeper-scout', 'deeper']));
    const rows = await d.db.select().from(loracleSpend).where(eq(loracleSpend.askId, late.body.id));
    expect(rows.every((r) => r.lane === 'dawn')).toBe(true);
    expect(rows.map((r) => r.stage).sort()).toEqual(['deeper', 'deeper-scout']);
  });

  it('sends a failed request again, and hands a refused or invalid one to the live lane', async () => {
    // Retried: the ROAD scout errors once and is sent again on its own.
    const a = await lorer(d);
    await drawn(d, a, 'I wish to haul the orange boats.');
    batches.failNext = { road: 'api_error' };
    const retried = await castForDawn(a);
    const roadId = retried.body.wish.road.id;
    await tickUntil(async () => (await roadRow(d, roadId)).status === 'drawn');
    const key = roadId.replace(/-/g, '');
    const roadsSent = batches.sent().filter((s) => s.custom_id.includes(key) && s.part === 'road');
    const keepersSent = batches.sent().filter((s) => s.custom_id.includes(key) && s.part === 'keepers');
    expect(roadsSent).toHaveLength(2);
    expect(keepersSent).toHaveLength(1);
    expect((await roadRow(d, roadId)).lane).toBe('dawn');

    // Invalid: the scouts weren't done, so the live lane casts it from the start.
    const b = await lorer(d);
    await drawn(d, b, 'I wish to know the team’s radio.');
    batches.failNext = { keepers: 'invalid_request_error' };
    const casts = dawnMind.casts;
    const invalid = await castForDawn(b);
    await tickUntil(async () => (await roadRow(d, invalid.body.wish.road.id)).status === 'drawn');
    expect(dawnMind.casts).toBe(casts + 1);
    expect(await roadRow(d, invalid.body.wish.road.id)).toMatchObject({ lane: 'now' });

    // Refused at compose: the live lane draws it from the ledger the scouts already built (with fallbacks).
    const c = await lorer(d);
    await drawn(d, c, 'I wish to read the fjord’s wind.');
    batches.failNext = { compose: 'refusal' };
    const draws = dawnMind.draws;
    const refused = await castForDawn(c);
    await tickUntil(async () => (await roadRow(d, refused.body.wish.road.id)).status === 'drawn');
    expect(dawnMind.draws).toBe(draws + 1);
    expect(dawnMind.lastFrom).toMatchObject({ task: 'quest' });
    expect(dawnMind.lastFrom!.ledger.sources!.length).toBeGreaterThan(0);
    expect((await roadRow(d, refused.body.wish.road.id)).quest!.title).toBe('The Resumed Road');
  });

  it('keeps its promise: a dawn road due within three hours is drawn live now', async () => {
    const c = await lorer(d);
    await drawn(d, c, 'I wish to sleep in the team hall.');
    batches.hold = true;
    try {
      const res = await cast(c);
      const roadId = res.body.wish.road.id;
      await d.db.update(wishRoads).set({ dueBy: new Date(Date.now() + 60 * 60 * 1000) }).where(eq(wishRoads.id, roadId));
      const casts = dawnMind.casts;
      const done = (await tick(d)).json();
      expect(done.live).toBeGreaterThanOrEqual(1);
      await d.app.wishJobs.idle();
      expect(await roadRow(d, roadId)).toMatchObject({ lane: 'now', status: 'drawn' });
      expect(dawnMind.casts).toBe(casts + 1);
    } finally {
      batches.hold = false;
      // Batches still out from this test end now, so later ticks can read them.
      for (const b of batches.created) batches.end(b.id);
      await tick(d);
      await d.app.wishJobs.idle();
    }
  });

  it('begins at most five of one Lorer’s dawn items in a night; the rest roll on', async () => {
    const c = await lorer(d);
    const day = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 10 * 60 * 60 * 1000);
    for (let i = 0; i < 6; i++) {
      const [w] = await d.db
        .insert(wishes)
        .values({
          userId: c.user.id,
          text: `I wish to climb hill number ${i + 1}.`,
          textKey: `hill-${i}`,
          context: { age: null, money: null, time: null, body: null, languages: null, passport: null, callings: [] },
          realm: { label: REALM.label, country: REALM.country, radiusKm: NO_LIMIT_KM },
          timeZone: 'Atlantic/Reykjavik',
          day,
          status: 'listening',
          weighing: STORM_WEIGHING,
        })
        .returning({ id: wishes.id });
      await d.db.insert(wishRoads).values({ wishId: w!.id, n: 1, status: 'queued', lane: 'dawn', day, dueBy: due, signs: [] });
    }
    batches.hold = true;
    try {
      await tick(d);
      const mine = await d.db
        .select({ batch: wishRoads.batch })
        .from(wishRoads)
        .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
        .where(eq(wishes.userId, c.user.id));
      expect(mine.filter((r) => (r.batch as RoadDawnState | null)?.begun)).toHaveLength(5);
    } finally {
      batches.hold = false;
      await d.db.delete(wishes).where(eq(wishes.userId, c.user.id));
      for (const b of batches.created) batches.end(b.id);
      await tick(d);
      await d.app.wishJobs.idle();
    }
  });

  it('writes past everyone’s daily budget for dawn, even on the Lorer’s first cast', async () => {
    const c = await lorer(d);
    const day = new Date().toISOString().slice(0, 10);
    const [budget] = await d.db
      .insert(loracleSpend)
      .values({ userId: null, utcDay: day, stage: 'compose', outcome: 'ok', model: 'test', ms: 1, inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, costMicros: 10_000_000 })
      .returning({ id: loracleSpend.id });
    try {
      const res = await cast(c, 'I wish to row the harbour at night.');
      expect(res.body.wish.road.lane).toBe('dawn');
    } finally {
      await d.db.delete(loracleSpend).where(eq(loracleSpend.id, budget!.id));
      await d.db.delete(wishes).where(eq(wishes.userId, c.user.id));
    }
  });

  it('fades what waits for dawn when the Lorer stops sending wishes', async () => {
    const c = await lorer(d);
    const wish = await drawn(d, c, 'I wish to learn the knots.');
    await c.post(`/api/loracle/waypoints/${wish.road.map[0]!.id}/ask`, {});
    await d.app.wishJobs.idle();
    const ask = await askForDawn(c, wish.road.map[1]!.id);
    const res = await castForDawn(c);
    await c.del('/api/loracle/consent');
    expect((await roadRow(d, res.body.wish.road.id)).status).toBe('faded');
    expect((await d.db.select().from(wishAsks).where(eq(wishAsks.id, ask.body.id)))[0]!.status).toBe('faded');
    expect((await d.db.select().from(wishes).where(eq(wishes.id, res.body.wish.id)))[0]!.status).toBe('faded');
    const sent = batches.created.length;
    await tick(d);
    expect(batches.created.length).toBe(sent);
  });

  it('sends nothing more for a road that faded while its batch went out (consent taken back mid-tick)', async () => {
    const c = await lorer(d);
    await drawn(d, c, 'I wish to keep the harbour light.');
    const res = await castForDawn(c);
    const roadId = res.body.wish.road.id;
    const key = roadId.replace(/-/g, '');
    batches.beforeCreate = async () => {
      await c.del('/api/loracle/consent');
    };
    await d.app.dawn.tick(); // the scouts go out while the Lorer stops sending wishes
    expect((await roadRow(d, roadId)).status).toBe('faded');
    for (let i = 0; i < 3; i++) {
      await d.app.dawn.tick();
      await d.app.wishJobs.idle();
    }
    expect(batches.sent().filter((s) => s.custom_id.includes(key)).map((s) => s.part).sort()).toEqual(['keepers', 'road']);
    expect(await roadRow(d, roadId)).toMatchObject({ status: 'faded', batch: null });
  });

  it('leaves a road too near its promise for a batch round trip to the promise keeper: drawn live once, never paid twice', async () => {
    const c = await lorer(d);
    await drawn(d, c, 'I wish to sound the storm horn.');
    const res = await cast(c);
    const roadId = res.body.wish.road.id;
    expect(res.body.wish.road.lane).toBe('dawn');
    await d.db.update(wishRoads).set({ dueBy: new Date(Date.now() + 4.5 * HOUR) }).where(eq(wishRoads.id, roadId));
    const key = roadId.replace(/-/g, '');
    await d.app.dawn.tick();
    expect(batches.sent().filter((s) => s.custom_id.includes(key))).toEqual([]);
    expect((await roadRow(d, roadId)).status).toBe('queued');
    const casts = dawnMind.casts;
    // Two hours on, the promise keeper takes it live.
    await d.app.dawn.tick(new Date(Date.now() + 2 * HOUR));
    await d.app.wishJobs.idle();
    expect(await roadRow(d, roadId)).toMatchObject({ lane: 'now', status: 'drawn' });
    expect(dawnMind.casts).toBe(casts + 1);
    expect(await d.db.select().from(loracleSpend).where(and(eq(loracleSpend.roadId, roadId), eq(loracleSpend.lane, 'dawn')))).toEqual([]);
  });

  it('is safe against itself: two processes ticking at once send each request once, count each result once, and delete each batch', async () => {
    const other = createDawnLane({ db: d.db, config: DAWN_CONFIG, batches, jobs: d.app.wishJobs, log: d.app.log, awake: true });
    const c = await lorer(d);
    await drawn(d, c, 'I wish to read the storm charts.');
    const res = await castForDawn(c);
    const roadId = res.body.wish.road.id;
    const key = roadId.replace(/-/g, '');
    for (let i = 0; i < 8 && (await roadRow(d, roadId)).status !== 'drawn'; i++) {
      await Promise.all([d.app.dawn.tick(), other.tick()]);
      await d.app.wishJobs.idle();
    }
    expect((await roadRow(d, roadId)).status).toBe('drawn');
    const mine = batches.sent().filter((s) => s.custom_id.includes(key));
    expect(mine.map((s) => s.part).sort()).toEqual(['compose', 'keepers', 'road']);
    const rows = await d.db.select().from(loracleSpend).where(eq(loracleSpend.roadId, roadId));
    expect(rows.map((r) => r.stage).sort()).toEqual(['compose', 'keepers', 'road']);
    // Read and taken, each batch is deleted at Anthropic, once.
    expect(batches.deleted).toEqual(expect.arrayContaining([...new Set(mine.map((s) => s.batch))]));
    expect(new Set(batches.deleted).size).toBe(batches.deleted.length);
  });

  it('keeps a burned dawn wish’s batch on its Lorer’s hidden count', async () => {
    const c = await lorer(d);
    await drawn(d, c, 'I wish to coil the ropes.');
    const res = await castForDawn(c);
    const roadId = res.body.wish.road.id;
    batches.hold = true;
    try {
      await d.app.dawn.tick(); // the scouts go out
    } finally {
      batches.hold = false;
    }
    expect((await c.del(`/api/loracle/wishes/${res.body.wish.id}`)).status).toBe(200);
    for (const b of batches.created) batches.end(b.id);
    await d.app.dawn.tick();
    const rows = await d.db.select().from(loracleSpend).where(eq(loracleSpend.roadId, roadId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.userId === c.user.id && r.lane === 'dawn')).toBe(true);
    expect(await castsInLast24h(d.db, c.user.id)).toBe(2);
  });

  it('never sends a dawn question at the care floor (one written before the route checked it)', async () => {
    const c = await lorer(d);
    const wish = await drawn(d, c, 'I wish to mend the nets.');
    const [ask] = await d.db
      .insert(wishAsks)
      .values({
        waypointId: wish.road.map[0]!.id,
        wishId: wish.id,
        userId: c.user.id,
        day: new Date().toISOString().slice(0, 10),
        lane: 'dawn',
        status: 'dawn',
        question: 'I want to kill myself.',
        dueBy: new Date(Date.now() + 20 * HOUR),
      })
      .returning();
    await d.app.dawn.tick();
    expect((await d.db.select().from(wishAsks).where(eq(wishAsks.id, ask!.id)))[0]!.status).toBe('silent');
    expect(batches.sent().filter((s) => s.custom_id.includes(ask!.id.replace(/-/g, '')))).toEqual([]);
  });

  it('sends a paused scout on in the next batch: its turn echoed back unchanged, no new user turn', async () => {
    const c = await lorer(d);
    await drawn(d, c, 'I wish to read the rescue charts.');
    batches.pauseNext = { road: true };
    const res = await castForDawn(c);
    const roadId = res.body.wish.road.id;
    await tickUntil(async () => (await roadRow(d, roadId)).status === 'drawn', 8, 'lane');
    const key = roadId.replace(/-/g, '');
    const roads = batches.sent().filter((s) => s.custom_id.includes(key) && s.part === 'road');
    expect(roads).toHaveLength(2);
    const [first, second] = roads.map((s) => s.params.messages);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(second![0]).toEqual(first![0]);
    expect(second![1]).toEqual({ role: 'assistant', content: pausedReply.content });
    expect(roads[1]!.batch).not.toBe(roads[0]!.batch);
    // The KEEPERS scout had finished: it is not sent again.
    expect(batches.sent().filter((s) => s.custom_id.includes(key) && s.part === 'keepers')).toHaveLength(1);
    // Both sends of the paused scout were paid for, and the road was drawn from the whole turn.
    const paid = await d.db.select().from(loracleSpend).where(and(eq(loracleSpend.roadId, roadId), eq(loracleSpend.stage, 'road')));
    expect(paid).toHaveLength(2);
    expect((await roadRow(d, roadId)).quest!.title).toBe('The Orange Boats');
  });

  it('draws an "Ask again" past the soft budget at dawn: from the kept ledger, no scouts, told of the road drawn before', async () => {
    const c = await lorer(d);
    await drawn(d, c, 'I wish to carry the radio on the search.');
    const res = await castForDawn(c);
    const wishId = res.body.wish.id;
    await tickUntil(async () => (await roadRow(d, res.body.wish.road.id)).status === 'drawn', 8, 'lane');
    const again = await c.post<Wish>(`/api/loracle/wishes/${wishId}/again`);
    expect(again.status).toBe(202);
    const second = again.body.roads.find((r) => r.n === 2)!;
    expect(second).toMatchObject({ lane: 'dawn', status: 'queued' });
    await d.db.update(wishRoads).set({ dueBy: new Date(Date.now() + 20 * HOUR) }).where(eq(wishRoads.id, second.id));
    const casts = dawnMind.casts;
    const draws = dawnMind.draws;
    await tickUntil(async () => (await roadRow(d, second.id)).status === 'drawn', 8, 'lane');
    expect([dawnMind.casts, dawnMind.draws]).toEqual([casts, draws]); // all of it at dawn
    const key = second.id.replace(/-/g, '');
    const sent = batches.sent().filter((s) => s.custom_id.includes(key));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((s) => s.part === 'compose')).toBe(true); // no scouts: the first road's ledger
    const system = sent[0]!.params.system as { text: string }[];
    expect(system.map((b) => b.text)).toEqual([COMPOSE_PROMPT, AGAIN_ADDENDUM]);
    const turn = sent[0]!.params.messages[0]!.content as string;
    expect(turn).toContain('<earlier_roads>');
    expect(turn).toContain('The Orange Boats');
    expect(turn).toContain('Sigrún Hafsteinsdóttir');
    // The scripted batch draws the same road again: H18 sends it back once, and what is left is rough.
    const road = await roadRow(d, second.id);
    expect(road.faults.some((f) => f.startsWith('H18'))).toBe(true);
    expect(road.rough).toBe(true);
    const rows = await d.db.select().from(loracleSpend).where(eq(loracleSpend.roadId, second.id));
    expect(rows.map((r) => r.stage).sort()).toEqual(['again', 'repair']);
    expect(rows.every((r) => r.lane === 'dawn' && r.userId === c.user.id)).toBe(true);
    const after = (await c.get<Wish>(`/api/loracle/wishes/${wishId}`)).body;
    expect(after.status).toBe('revealed');
    expect(after.roads.map((r) => [r.n, r.status])).toEqual([
      [1, 'drawn'],
      [2, 'drawn'],
    ]);
  });

  it('rolls an extra past the fair share on a night when its promise is near: its dawn moves a day', async () => {
    const c = await lorer(d);
    const day = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 5.5 * HOUR); // past the 5 h a batch round trip needs, inside the 6 h roll
    for (let i = 0; i < 6; i++) {
      const [w] = await d.db
        .insert(wishes)
        .values({
          userId: c.user.id,
          text: `I wish to cross fjord number ${i + 1}.`,
          textKey: `fjord-${i}`,
          context: { age: null, money: null, time: null, body: null, languages: null, passport: null, callings: [] },
          realm: { label: REALM.label, country: REALM.country, radiusKm: NO_LIMIT_KM },
          timeZone: 'Atlantic/Reykjavik',
          day,
          status: 'listening',
          weighing: STORM_WEIGHING,
        })
        .returning({ id: wishes.id });
      await d.db.insert(wishRoads).values({ wishId: w!.id, n: 1, status: 'queued', lane: 'dawn', day, dueBy: due, signs: [] });
    }
    batches.hold = true;
    try {
      await d.app.dawn.tick();
      const mine = await d.db
        .select({ batch: wishRoads.batch, dueBy: wishRoads.dueBy, status: wishRoads.status })
        .from(wishRoads)
        .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
        .where(eq(wishes.userId, c.user.id));
      expect(mine.filter((r) => (r.batch as RoadDawnState | null)?.begun)).toHaveLength(5);
      const rolled = mine.filter((r) => !(r.batch as RoadDawnState | null)?.begun);
      expect(rolled).toHaveLength(1);
      expect(rolled[0]).toMatchObject({ status: 'queued' });
      expect(rolled[0]!.dueBy!.getTime()).toBe(due.getTime() + 24 * HOUR);
    } finally {
      batches.hold = false;
      await d.db.delete(wishes).where(eq(wishes.userId, c.user.id));
      for (const b of batches.created) batches.end(b.id);
      await d.app.dawn.tick();
      await d.app.wishJobs.idle();
    }
  });

  it('keeps its promise to a question too; past the owner’s ceiling, what is due waits for the new moon instead', async () => {
    const c = await lorer(d);
    const wish = await drawn(d, c, 'I wish to stand watch at the harbour mouth.');
    await c.post(`/api/loracle/waypoints/${wish.road.map[0]!.id}/ask`, {});
    await d.app.wishJobs.idle();
    const ask = await askForDawn(c, wish.road.map[1]!.id, { question: 'Too late?' });
    const later = await castForDawn(c);
    const soon = new Date(Date.now() + HOUR);
    await d.db.update(wishAsks).set({ dueBy: soon }).where(eq(wishAsks.id, ask.body.id));
    await d.db.update(wishRoads).set({ dueBy: soon }).where(eq(wishRoads.id, later.body.wish.road.id));
    const askRow = async () => (await d.db.select().from(wishAsks).where(eq(wishAsks.id, ask.body.id)))[0]!;
    const wishRow = async () => (await d.db.select().from(wishes).where(eq(wishes.id, later.body.wish.id)))[0]!;
    const deepers = dawnMind.deepers;
    const casts = dawnMind.casts;
    const [ceiling] = await d.db
      .insert(loracleSpend)
      .values({ userId: null, utcDay: new Date().toISOString().slice(0, 10), stage: 'compose', outcome: 'ok', model: 'test', ms: 1, inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, costMicros: 150_000_000 })
      .returning({ id: loracleSpend.id });
    try {
      await d.app.dawn.tick();
      await d.app.wishJobs.idle();
      // Past the ceiling: the cast waits for the new moon, the question stays written down; nothing is sent.
      expect((await wishRow()).status).toBe('moon');
      expect(await roadRow(d, later.body.wish.road.id)).toMatchObject({ lane: 'now', status: 'queued', dueBy: null });
      expect(await askRow()).toMatchObject({ status: 'dawn', lane: 'dawn' });
      expect([dawnMind.deepers, dawnMind.casts]).toEqual([deepers, casts]);
    } finally {
      await d.db.delete(loracleSpend).where(eq(loracleSpend.id, ceiling!.id));
    }
    // The new moon: the question due within three hours is answered live now, and the wish wakes.
    await d.app.dawn.tick();
    await d.app.wishJobs.idle();
    expect(await askRow()).toMatchObject({ status: 'answered', lane: 'now' });
    expect(dawnMind.deepers).toBe(deepers + 1);
    expect(dawnMind.casts).toBe(casts + 1);
    expect((await wishRow()).status).toBe('revealed');
  });
});
