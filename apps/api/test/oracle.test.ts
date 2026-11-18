import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '../src/db/index.ts';
import { worldCache } from '../src/db/schema.ts';
import { generateFutures, type OracleInput } from '../src/lib/oracle.ts';
import {
  backOffMs,
  distanceKm,
  NOTABLE_KINDS,
  openDataWorld,
  type DayWeather,
  type Forecast,
  type WorldData,
  type WorldPlace,
} from '../src/lib/world.ts';
import { NO_LIMIT_KM } from '#shared';
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

// Far beyond HOME, due north or south (1° of latitude ≈ 111 km).
const FAR: WorldPlace[] = [
  { id: 'Q20', name: 'Distant Falls', kind: 'waterfall', lat: HOME.lat + 3, lon: HOME.lon, sitelinks: 12 }, // ≈334 km
  { id: 'Q21', name: 'Edge Castle', kind: 'castle', lat: HOME.lat - 5, lon: HOME.lon, sitelinks: 30 }, // ≈556 km
  { id: 'Q22', name: 'Great Peak', kind: 'mountain', lat: HOME.lat + 7.5, lon: HOME.lon, sitelinks: 25 }, // ≈834 km
  { id: 'Q23', name: 'Far Museum', kind: 'museum', lat: HOME.lat - 3.2, lon: HOME.lon, sitelinks: 8 }, // ≈356 km
  { id: 'Q24', name: 'Beyond Reach', kind: 'volcano', lat: HOME.lat - 9.5, lon: HOME.lon, sitelinks: 90 }, // ≈1056 km
];

// Across the world from HOME (Reykjavík).
const FAR_SHORES: WorldPlace[] = [
  { id: 'Q30', name: 'Snow Crown', kind: 'mountain', lat: -3.07, lon: 37.35, sitelinks: 120 }, // ≈9,700 km
  { id: 'Q31', name: 'Old Capital Museum', kind: 'museum', lat: 35.71, lon: 139.77, sitelinks: 80 }, // ≈8,800 km
  { id: 'Q32', name: 'Southern Falls', kind: 'waterfall', lat: -25.69, lon: -54.44, sitelinks: 95 }, // ≈10,900 km
];

/** Every future at a place more than 250 km away must be a journey of a night or more. */
function expectJourneys<F extends { place: { distanceKm: number } | null; startsAt: string; endsAt: string | null; story: string; signs: string[] }>(
  futures: F[],
): F[] {
  const far = futures.filter((f) => f.place && f.place.distanceKm > 250);
  for (const f of far) {
    const km = f.place!.distanceKm;
    expect(km).toBeLessThanOrEqual(1000);
    const hours = (Date.parse(f.endsAt!) - Date.parse(f.startsAt)) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(km > 400 ? 48 : 24);
    expect(f.signs).toContain(km > 400 ? 'Two nights away' : 'One night away');
    expect(f.story).toMatch(/\d+ hours (on the road|by road) each way/);
    if ((km * 1.3) / 80 > 8.5) expect(f.story).toContain('a train or a flight');
  }
  return far;
}

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

  it('goes as far as the realm reaches, and makes far places journeys, never a day out', () => {
    const now = new Date();
    // Everything mixed together: whatever is dealt, far places are always journeys.
    let shown = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      for (const mode of ['mixed', 'mine', 'wild'] as const) {
        const futures = generateFutures(baseInput({ now, seed, mode, radiusKm: 1000, interests: ['road_trips', 'sky'], places: [...PLACES, ...FAR] }));
        shown += expectJourneys(futures).length;
        expect(futures.some((f) => f.place?.wikidataId === 'Q24')).toBe(false); // past 1000 km
      }
    }
    expect(shown).toBeGreaterThan(0);

    // Only far places: a road-tripper is offered a journey, the same one for the same seed.
    const input = baseInput({ now, mode: 'mine', radiusKm: 1000, interests: ['road_trips'], places: FAR, kp: [] });
    const futures = generateFutures(input);
    expect(generateFutures(input)).toEqual(futures);
    const journeys = expectJourneys(futures);
    expect(journeys.length).toBeGreaterThan(0);
    for (const f of journeys) {
      expect(['🗺️', '🧳']).toContain(f.emoji);
      expect(['expedition', 'road_trip']).toContain(f.category);
    }

    // A smaller realm never reaches them.
    expect(generateFutures(baseInput({ now, radiusKm: 250, places: FAR })).filter((f) => f.place)).toEqual([]);
  });

  it('with no limit, sends you to far shores: by air, a week away', () => {
    const now = new Date();
    let shores = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      for (const mode of ['mixed', 'mine', 'wild'] as const) {
        const futures = generateFutures(baseInput({ now, seed, mode, radiusKm: NO_LIMIT_KM, places: [...PLACES, ...FAR, ...FAR_SHORES] }));
        for (const f of futures.filter((x) => x.place && x.place.distanceKm > 1500)) {
          shores++;
          expect(f.title).toMatch(/^A Far Shore: /);
          expect(f.signs).toContain('A week away: ask for the time off');
          expect(f.signs.some((s) => /h in the air each way/.test(s))).toBe(true);
          expect(f.story).not.toMatch(/by road|on the road/);
          expect((Date.parse(f.endsAt!) - Date.parse(f.startsAt)) / 86_400_000).toBeGreaterThanOrEqual(7);
        }
        // Road journeys stay on this side of the far shores.
        expectJourneys(futures.filter((f) => !f.place || f.place.distanceKm <= 1500));
      }
    }
    expect(shores).toBeGreaterThan(0);
    // Only far shores, and only for a realm that reaches them.
    expect(generateFutures(baseInput({ now, radiusKm: 1000, places: FAR_SHORES })).filter((f) => f.place)).toEqual([]);
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
  let cleo: Client;
  const world: WorldData = {
    // A wide realm reaches the far places (and only those, so they get dealt).
    places: async (_lat, _lon, radiusKm) => (radiusKm > 300 ? FAR : PLACES),
    forecast: async () => clearWeek(),
    kp: async () => strongKp(),
    geocode: async (q) => [{ label: `${q}, Iceland`, lat: HOME.lat, lon: HOME.lon }],
  };

  beforeAll(async () => {
    t = await createTestApp({ world });
    ana = await t.signUp('anna');
    bo = await t.signUp('bobo');
    cleo = await t.signUp('cleo');
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

  it('lets you go anywhere (no limit), and plans the far places as journeys', async () => {
    expect((await cleo.put('/api/oracle/settings', { radiusKm: NO_LIMIT_KM })).status).toBe(200);
    expect((await cleo.put('/api/oracle/settings', { radiusKm: NO_LIMIT_KM + 1 })).status).toBe(400);
    expect((await cleo.put('/api/oracle/settings', { radiusKm: 9 })).status).toBe(400);
    const saved = await cleo.put('/api/oracle/settings', {
      home: { label: 'Reykjavík', ...HOME },
      radiusKm: 1000,
      interests: ['road_trips'],
      timeZone: 'Atlantic/Reykjavik',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.radiusKm).toBe(1000);

    const res = await cleo.post('/api/oracle/readings', { mode: 'mine' });
    expect(res.status).toBe(201);
    const far = expectJourneys(res.body.futures);
    expect(far.length).toBeGreaterThan(0);
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

describe('the far ring (places past 300 km)', () => {
  let database: Database;
  beforeAll(async () => {
    database = await openDatabase({});
    await database.migrate();
  });
  beforeEach(async () => {
    await database.db.delete(worldCache);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await database.close();
  });

  const KINDS = NOTABLE_KINDS.map((k) => k.type);
  // Real places and page counts (the ids are made up).
  const INDEX: Record<string, { id: string; name: string; lat: number; lon: number; links: number }[]> = {
    // On the Faroe Islands, ~780 km from Reykjavík over the sea: the nearest land past 300 km.
    Q8502: [
      { id: 'Q901', name: 'Slættaratindur', lat: 62.2117, lon: -6.9997, links: 35 },
      { id: 'Q902', name: 'Mont Blanc', lat: 45.8326, lon: 6.8652, links: 120 }, // ~800 km from London, 2,900 from Reykjavík
    ],
    Q207694: [{ id: 'Q903', name: 'Listasavn Føroya', lat: 62.0167, lon: -6.7833, links: 17 }],
    Q8072: [{ id: 'Q904', name: 'Hekla', lat: 63.98, lon: -19.7, links: 60 }], // ~110 km: the near query has it too
  };
  const HEKLA = INDEX.Q8072![0]!;

  /** A stand-in for Wikidata. Near queries: a castle at the cell's centre (and Hekla when in reach). */
  function fakeWikidata(
    opts: {
      fail?: (what: string) => { status: number; retryAfter?: string } | undefined;
      hold?: (what: string) => Promise<void> | undefined;
    } = {},
  ) {
    const asked: string[] = [];
    let indexRunning = 0;
    let indexMost = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const query = new URLSearchParams(String(init.body)).get('query')!;
      const type = /wdt:P31 wd:(Q\d+) ; wikibase:sitelinks/.exec(query)?.[1];
      const [, lon, lat] = (/Point\(([-\d.]+) ([-\d.]+)\)/.exec(query) ?? []).map(Number);
      const what = type ?? `near ${lat},${lon}`;
      asked.push(what);
      if (type) indexMost = Math.max(indexMost, ++indexRunning);
      try {
        await new Promise((r) => setTimeout(r, 5));
        await opts.hold?.(what);
        const fail = opts.fail?.(what);
        if (fail) {
          return new Response('upstream request timeout', {
            status: fail.status,
            headers: fail.retryAfter ? { 'retry-after': fail.retryAfter } : {},
          });
        }
        const typed = (id: string, name: string, kind: string) => ({
          item: { value: `http://www.wikidata.org/entity/${id}` },
          itemLabel: { value: name },
          type: { value: `http://www.wikidata.org/entity/${kind}` },
        });
        const bindings = type
          ? (INDEX[type] ?? []).map((p) => ({
              ...typed(p.id, p.name, type),
              loc: { value: `Point(${p.lon} ${p.lat})` },
              links: { value: String(p.links) },
            }))
          : [
              { ...typed(`Q7${lat}${lon}`, `Castle ${lat} ${lon}`, 'Q23413'), lat: { value: String(lat) }, lon: { value: String(lon) } },
              ...(distanceKm(lat!, lon!, HEKLA.lat, HEKLA.lon) < 300
                ? [{ ...typed(HEKLA.id, HEKLA.name, 'Q8072'), lat: { value: String(HEKLA.lat) }, lon: { value: String(HEKLA.lon) } }]
                : []),
            ];
        return new Response(JSON.stringify({ results: { bindings } }), { status: 200 });
      } finally {
        if (type) indexRunning--;
      }
    });
    return { asked, index: () => asked.filter((a) => !a.startsWith('near')), indexMost: () => indexMost };
  }
  const names = (places: WorldPlace[]) => places.map((p) => p.name);

  it('reaches every notable place in the realm, from one query per kind that serves every home', async () => {
    const wikidata = fakeWikidata();
    const world = openDataWorld(database.db);

    const reykjavik = await world.places(64.14, -21.94, 1000);
    // An island home finds the nearest land past the sea.
    expect(names(reykjavik)).toEqual(expect.arrayContaining(['Castle 64 -22', 'Hekla', 'Slættaratindur', 'Listasavn Føroya']));
    expect(names(reykjavik)).not.toContain('Mont Blanc'); // past 1000 km
    expect(names(reykjavik).filter((n) => n === 'Hekla')).toHaveLength(1);
    expect(reykjavik.find((p) => p.name === 'Hekla')?.sitelinks).toBe(60);
    // One near query, and each kind once, one at a time.
    expect(wikidata.asked.filter((a) => a.startsWith('near'))).toEqual(['near 64,-22']);
    expect([...wikidata.index()].sort()).toEqual([...KINDS].sort());
    expect(wikidata.indexMost()).toBe(1);

    // Another home shares the index: only its own near query is asked.
    const asked = wikidata.asked.length;
    const london = await world.places(51.5, -0.12, 1000);
    expect(wikidata.asked.slice(asked)).toEqual(['near 51.5,0']);
    expect(names(london)).toContain('Mont Blanc');
    expect(names(london)).not.toContain('Slættaratindur');
    // A realm within 300 km doesn't use it.
    expect(names(await world.places(64.14, -21.94, 200))).toEqual(['Castle 64 -22', 'Hekla']);

    // After a restart it's all in the database: nothing is asked again.
    const before = wikidata.asked.length;
    expect(await openDataWorld(database.db).places(64.14, -21.94, 1000)).toEqual(reykjavik);
    expect(wikidata.asked.length).toBe(before);
  });

  it('puts a kind that fails to rest for a day, across restarts too, and still brings the others', async () => {
    const failing = 'Q23413'; // castles: Wikidata times out
    const wikidata = fakeWikidata({ fail: (what) => (what === failing ? { status: 504 } : undefined) });
    const world = openDataWorld(database.db);

    await world.places(64.14, -21.94, 1000);
    // The round ended at the failure; the kinds after it wait for the next reading.
    expect(wikidata.index()).toEqual(KINDS.slice(0, KINDS.indexOf(failing) + 1));

    // The next reading doesn't wait for them, and goes on without the failed kind.
    await world.places(64.14, -21.94, 1000);
    await vi.waitFor(() => expect(wikidata.index()).toHaveLength(KINDS.length));
    expect(wikidata.index().filter((t) => t === failing)).toHaveLength(1);
    await vi.waitFor(async () => expect(names(await world.places(64.14, -21.94, 1000))).toContain('Slættaratindur'));

    // A restart remembers the failure: castles aren't asked for again today.
    const restarted = openDataWorld(database.db);
    await restarted.places(64.14, -21.94, 1000);
    await new Promise((r) => setTimeout(r, 200));
    expect(wikidata.index()).toHaveLength(KINDS.length);
  });

  it('waits as long as Wikidata asks when it says 429, near queries too', async () => {
    const wikidata = fakeWikidata({ fail: (what) => (what === KINDS[0] ? { status: 429, retryAfter: '120' } : undefined) });
    const world = openDataWorld(database.db);
    await world.places(64.14, -21.94, 200); // the near query, cached

    // The index stops at the 429; the reading goes on with what it has.
    expect(names(await world.places(64.14, -21.94, 1000))).toEqual(['Castle 64 -22', 'Hekla']);
    expect(wikidata.index()).toEqual([KINDS[0]]);
    // Meanwhile nothing is sent, not even a new home's near query, and nothing is marked failed.
    expect(await world.places(40, 10, 100)).toEqual([]);
    expect(await world.places(64.14, -21.94, 1000)).toHaveLength(2);
    expect(wikidata.asked).toEqual(['near 64,-22', KINDS[0]]);
    const keys = (await database.db.select({ key: worldCache.key }).from(worldCache)).map((r) => r.key);
    expect(keys.filter((k) => k.endsWith(':failed'))).toEqual([]);

    expect(backOffMs(429, '120')).toBe(120_000);
    expect(backOffMs(429, null)).toBe(60_000);
    expect(backOffMs(429, 'Wed, 18 Nov 2026 10:05:00 GMT', Date.parse('2026-11-18T10:00:00Z'))).toBe(300_000);
    expect(backOffMs(403, '10')).toBe(3_600_000);
  });

  it("doesn't keep a reading waiting for a slow query, and has the places next time", async () => {
    let release = () => {};
    const until = new Promise<void>((r) => (release = r));
    const wikidata = fakeWikidata({ hold: (what) => (what === KINDS[0] ? until : undefined) });
    const world = openDataWorld(database.db, { farWaitMs: 100 });

    const first = await world.places(64.14, -21.94, 1000);
    expect(names(first)).toEqual(['Castle 64 -22', 'Hekla']);

    release();
    await vi.waitFor(async () => expect(names(await world.places(64.14, -21.94, 1000))).toContain('Slættaratindur'));
    // Each kind was asked once, the slow one too, not again by the readings in between.
    expect([...wikidata.index()].sort()).toEqual([...KINDS].sort());
  });
});
