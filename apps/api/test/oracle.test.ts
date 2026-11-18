import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFutures, type OracleInput } from '../src/lib/oracle.ts';
import type { DayWeather, Forecast, WorldData, WorldPlace } from '../src/lib/world.ts';
import { createTestApp, type Client, type TestApp } from './helpers.ts';

const HOME = { lat: 64.14, lon: -21.94 };

// A small made-up realm around HOME (kilometres are approximate).
const PLACES: WorldPlace[] = [
  { id: 'Q1', name: 'Tall Falls', kind: 'waterfall', lat: 64.4, lon: -21.5 },
  { id: 'Q2', name: 'Warm Pool', kind: 'hot_spring', lat: 64.0, lon: -21.3 },
  { id: 'Q3', name: 'City Museum', kind: 'museum', lat: 64.15, lon: -21.95 },
  { id: 'Q4', name: 'Black Beach', kind: 'beach', lat: 63.9, lon: -22.3 },
  { id: 'Q5', name: 'Old Light', kind: 'lighthouse', lat: 64.6, lon: -22.4 },
  { id: 'Q6', name: 'Fire Mountain', kind: 'volcano', lat: 63.9, lon: -20.8 },
  { id: 'Q7', name: 'Stone Ring', kind: 'ruins', lat: 64.3, lon: -21.0 },
  { id: 'Q8', name: 'Far Glacier', kind: 'glacier', lat: 64.6, lon: -20.2 },
];

function clearWeek(start = new Date()): Forecast {
  const days: DayWeather[] = Array.from({ length: 8 }, (_, i) => {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      code: 0,
      tMax: 9,
      tMin: 2,
      precip: 0,
      windMax: 5,
      sunrise: `${date}T09:30`,
      sunset: `${date}T16:40`,
      cloudNight: 10,
      cloudDawn: 15,
    };
  });
  return { timeZone: 'Atlantic/Reykjavik', utcOffsetSeconds: 0, days };
}

const strongKp = (start = new Date()) =>
  Array.from({ length: 24 }, (_, i) => ({
    time: new Date(Math.floor(start.getTime() / 10_800_000) * 10_800_000 + i * 10_800_000).toISOString(),
    kp: 4.3,
  }));

const baseInput = (over: Partial<OracleInput> = {}): OracleInput => ({
  now: new Date(),
  seed: 'test-seed',
  mode: 'mixed',
  home: HOME,
  radiusKm: 150,
  interests: ['sky', 'water'],
  forecast: clearWeek(),
  kp: strongKp(),
  places: PLACES,
  busy: [],
  crews: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Night Owls', emoji: '🦉' }],
  ideas: [],
  memories: [],
  recentPlaceIds: new Set(),
  ...over,
});

describe('the Oracle engine', () => {
  it('reveals three different futures, all ahead of us', () => {
    const futures = generateFutures(baseInput());
    expect(futures).toHaveLength(3);
    expect(new Set(futures.map((f) => f.title)).size).toBe(3);
    for (const f of futures) {
      expect(Date.parse(f.startsAt)).toBeGreaterThan(Date.now());
      expect(f.story.length).toBeGreaterThan(20);
      expect(f.signs.length).toBeGreaterThan(0);
      expect(f.timeZone).toBe('Atlantic/Reykjavik');
    }
  });

  it('gives the same answer for the same seed, and another for another seed', () => {
    const now = new Date();
    const a = generateFutures(baseInput({ now }));
    const b = generateFutures(baseInput({ now }));
    expect(b).toEqual(a);
    const titles = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      for (const f of generateFutures(baseInput({ now, seed }))) titles.add(f.title);
    }
    expect(titles.size).toBeGreaterThan(3);
  });

  it('mixes two of your paths with one wildcard', () => {
    const futures = generateFutures(baseInput({ mode: 'mixed' }));
    expect(futures.filter((f) => f.kind === 'wildcard')).toHaveLength(1);
    expect(futures.filter((f) => f.kind === 'interest')).toHaveLength(2);
  });

  it('"my path" follows your interests; "wild" ignores them', () => {
    const mine = generateFutures(baseInput({ mode: 'mine', interests: ['sky', 'water'] }));
    expect(mine).toHaveLength(3);
    expect(mine.every((f) => f.kind !== 'wildcard')).toBe(true);
    expect(mine.every((f) => ['🌌', '✨', '🌅', '♨️', '🌊'].includes(f.emoji))).toBe(true);

    const wild = generateFutures(baseInput({ mode: 'wild', interests: ['sky'] }));
    expect(wild.every((f) => f.kind === 'wildcard')).toBe(true);
    expect(wild.some((f) => ['🌌', '✨', '🌅'].includes(f.emoji))).toBe(false);
  });

  it('never books you when you are busy', () => {
    const now = new Date();
    const busy = [{ start: new Date(now.getTime() + 2 * 86_400_000), end: new Date(now.getTime() + 6 * 86_400_000) }];
    for (const seed of ['1', '2', '3', '4']) {
      for (const f of generateFutures(baseInput({ now, seed, busy }))) {
        const start = Date.parse(f.startsAt);
        const end = Date.parse(f.endsAt ?? f.startsAt);
        expect(start < busy[0]!.end.getTime() && end > busy[0]!.start.getTime()).toBe(false);
      }
    }
  });

  it('only sees the aurora when the sky allows it', () => {
    const cloudy = clearWeek();
    for (const d of cloudy.days) d.cloudNight = 95;
    const seen = (input: OracleInput) => generateFutures(input).some((f) => f.emoji === '🌌');
    expect(seen(baseInput({ mode: 'mine', interests: ['sky'] }))).toBe(true);
    expect(seen(baseInput({ mode: 'mine', interests: ['sky'], forecast: cloudy }))).toBe(false);
    expect(seen(baseInput({ mode: 'mine', interests: ['sky'], kp: [] }))).toBe(false);
  });

  it('keeps to the realm and stays away from places shown lately', () => {
    const near = generateFutures(baseInput({ radiusKm: 10, kp: [] }));
    for (const f of near) if (f.place) expect(f.place.distanceKm).toBeLessThanOrEqual(10);
    // Two museums in town; the one shown lately makes way for the other.
    const town: WorldPlace[] = [PLACES[2]!, { id: 'Q9', name: 'Glass House', kind: 'botanical_garden', lat: 64.13, lon: -21.9 }];
    const fresh = generateFutures(baseInput({ places: town, recentPlaceIds: new Set(['Q3']), kp: [] }));
    const shown = fresh.filter((f) => f.place).map((f) => f.place!.wikidataId);
    expect(shown).toEqual(['Q9']);
  });

  it('can revive an idea from the vault and echo an old memory', () => {
    const lastYear = new Date();
    lastYear.setUTCFullYear(lastYear.getUTCFullYear() - 2);
    const input = baseInput({
      places: [],
      kp: [],
      forecast: null,
      ideas: [{ id: 'idea-1', title: 'Sleep under the stars', category: 'outdoor', whereNote: null, crewId: null }],
      memories: [{ id: 'ch-1', title: 'The great soup night', occurredOn: lastYear.toISOString().slice(0, 10), locationName: 'Our kitchen' }],
    });
    const futures = generateFutures(input);
    expect(futures.find((f) => f.kind === 'idea')?.ideaId).toBe('idea-1');
    const echo = futures.find((f) => f.kind === 'memory');
    expect(echo?.chapterId).toBe('ch-1');
    expect(echo?.story).toContain('2 years ago');
  });

  it('stays quiet with nothing to go on', () => {
    expect(generateFutures(baseInput({ places: [], kp: [], forecast: null, crews: [] }))).toEqual([]);
  });
});

describe('the Oracle API', () => {
  let t: TestApp;
  let ana: Client;
  let bo: Client;
  const world: WorldData = {
    places: async () => PLACES,
    forecast: async () => clearWeek(),
    kp: async () => strongKp(),
    geocode: async (q) => [{ label: `${q}, Iceland`, lat: HOME.lat, lon: HOME.lon }],
  };

  beforeAll(async () => {
    t = await createTestApp({ world });
    ana = await t.signUp('anna');
    bo = await t.signUp('bobo');
  });
  afterAll(() => t.close());

  it('asks for a realm before reading the stones', async () => {
    const state = await ana.get('/api/oracle');
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ settings: { home: null, radiusKm: 80, interests: [], timeZone: 'UTC' }, reading: null });
    expect((await ana.post('/api/oracle/readings', {})).status).toBe(400);
  });

  it('finds places by name', async () => {
    const res = await ana.get('/api/oracle/geocode?q=Reykjavik');
    expect(res.status).toBe(200);
    expect(res.body[0].label).toBe('Reykjavik, Iceland');
    expect((await ana.get('/api/oracle/geocode?q=x')).status).toBe(400);
  });

  it('saves the realm privately', async () => {
    const res = await ana.put('/api/oracle/settings', {
      home: { label: 'Reykjavík', ...HOME },
      radiusKm: 150,
      interests: ['sky', 'water', 'sky'],
      timeZone: 'Atlantic/Reykjavik',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      home: { label: 'Reykjavík', ...HOME },
      radiusKm: 150,
      interests: ['sky', 'water'],
      timeZone: 'Atlantic/Reykjavik',
    });
    expect((await ana.put('/api/oracle/settings', { timeZone: 'Mars/Olympus' })).status).toBe(400);
    expect((await ana.put('/api/oracle/settings', { interests: ['knitting'] })).status).toBe(400);
    // Bobo's realm is their own.
    expect((await bo.get('/api/oracle')).body.settings.home).toBeNull();
  });

  let readingId = '';

  it('reveals three futures and remembers them for the day', async () => {
    const res = await ana.post('/api/oracle/readings', { mode: 'mixed' });
    expect(res.status).toBe(201);
    expect(res.body.futures).toHaveLength(3);
    expect(res.body.readingsLeftToday).toBe(2);
    expect(res.body.futures.every((f: any) => f.status === 'open' && f.eventId === null)).toBe(true);
    readingId = res.body.id;

    const state = await ana.get('/api/oracle');
    expect(state.body.reading.id).toBe(readingId);
    expect(state.body.reading.futures).toEqual(res.body.futures);
  });

  it('turns a chosen future into a real plan', async () => {
    const reading = (await ana.get('/api/oracle')).body.reading;
    const future = reading.futures[0];
    const res = await ana.post(`/api/oracle/readings/${readingId}/futures/0/choose`, { crewId: null });
    expect(res.status).toBe(201);
    const chosen = res.body.futures[0];
    expect(chosen.status).toBe('chosen');
    expect(chosen.eventId).toBeTruthy();

    const event = await ana.get(`/api/events/${chosen.eventId}`);
    expect(event.status).toBe(200);
    expect(event.body.title).toBe(future.title);
    expect(event.body.startsAt).toBe(future.startsAt);
    expect(event.body.myRole).toBe('organizer');
    expect(event.body.description).toContain('Revealed by the Oracle.');
    expect(event.body.locationName).toBe(future.place?.name ?? null);
    // The plan is Ana's; Bo isn't invited and can't see it.
    expect((await bo.get(`/api/events/${chosen.eventId}`)).status).toBe(404);

    // Choosing twice doesn't make two plans.
    const again = await ana.post(`/api/oracle/readings/${readingId}/futures/0/choose`, {});
    expect(again.body.futures[0].eventId).toBe(chosen.eventId);
    expect((await ana.post(`/api/oracle/readings/${readingId}/futures/0/dismiss`)).status).toBe(400);
  });

  it('saves a future to the vault, privately', async () => {
    const res = await ana.post(`/api/oracle/readings/${readingId}/futures/1/save`);
    expect(res.status).toBe(200);
    const saved = res.body.futures[1];
    expect(saved.status).toBe('saved');
    const idea = await ana.get(`/api/ideas/${saved.savedIdeaId}`);
    expect(idea.status).toBe(200);
    expect(idea.body.audience).toBe('only_me');
    expect(idea.body.whenNote).toMatch(/^The stones suggested /);
    expect((await bo.get(`/api/ideas/${saved.savedIdeaId}`)).status).toBe(404);
  });

  it('lets a future pass', async () => {
    const res = await ana.post(`/api/oracle/readings/${readingId}/futures/2/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body.futures[2].status).toBe('dismissed');
    expect((await ana.post(`/api/oracle/readings/${readingId}/futures/7/dismiss`)).status).toBe(404);
  });

  it("keeps a reading to its reader", async () => {
    for (const action of ['choose', 'save', 'dismiss']) {
      expect((await bo.post(`/api/oracle/readings/${readingId}/futures/1/${action}`)).status).toBe(404);
    }
  });

  it("won't put you in a crew you're not in", async () => {
    const crew = await bo.post('/api/crews', { name: "Bo's crew", emoji: '🐻' });
    const fresh = await ana.post('/api/oracle/readings', { mode: 'wild' });
    expect(fresh.status).toBe(201);
    const res = await ana.post(`/api/oracle/readings/${fresh.body.id}/futures/0/choose`, { crewId: crew.body.id });
    expect(res.status).toBe(400);
  });

  it('speaks three times a day, no more', async () => {
    expect((await ana.post('/api/oracle/readings', { mode: 'mine' })).body.readingsLeftToday).toBe(0);
    const res = await ana.post('/api/oracle/readings', {});
    expect(res.status).toBe(429);
    expect((await ana.get('/api/oracle')).body.reading.readingsLeftToday).toBe(0);
  });

  it('includes the realm and readings in the data export', async () => {
    const res = await ana.get('/api/me/export');
    expect(res.status).toBe(200);
    expect(res.body.oracle.settings.homeLabel).toBe('Reykjavík');
    expect(res.body.oracle.readings).toHaveLength(3);
  });
});
