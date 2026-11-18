// The world as the Oracle sees it, from free open-data services:
//   places   Wikidata (notable waterfalls, hot springs, peaks, ruins, museums…)
//   weather  Open-Meteo (7-day forecast, cloud cover, sunrise/sunset)
//   aurora   NOAA SWPC planetary Kp forecast
//   geocode  Nominatim (OpenStreetMap), for typing in your home area
// Every answer is cached in `world_cache`; when a service is down the last known
// answer is used, and with nothing at all the Oracle works with what it has.
// Each service's usage policy is respected: an identifying User-Agent, caching,
// at most one Nominatim request per second, and waiting out Wikidata when it says 429.
import { eq, sql } from 'drizzle-orm';
import type { GeocodeResult } from '#shared';
import type { Db } from '../db/index.ts';
import { worldCache } from '../db/schema.ts';

export type PlaceKind =
  | 'waterfall'
  | 'hot_spring'
  | 'geyser'
  | 'glacier'
  | 'volcano'
  | 'cave'
  | 'mountain'
  | 'national_park'
  | 'beach'
  | 'lighthouse'
  | 'museum'
  | 'art_museum'
  | 'archaeological_site'
  | 'castle'
  | 'ruins'
  | 'botanical_garden';

export interface WorldPlace {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  /** How many Wikimedia pages the place has: a rough measure of how notable it is. Places from the notable index carry it. */
  sitelinks?: number;
}

export interface DayWeather {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** WMO weather code. */
  code: number;
  tMax: number;
  tMin: number;
  precip: number;
  windMax: number;
  /** Local wall-clock times, YYYY-MM-DDTHH:MM. */
  sunrise: string;
  sunset: string;
  /** Average cloud cover (%) from 21:00 to 03:00 the following night. */
  cloudNight: number;
  /** Average cloud cover (%) in the two hours around sunrise. */
  cloudDawn: number;
}

export interface Forecast {
  timeZone: string;
  utcOffsetSeconds: number;
  days: DayWeather[];
}

export interface KpReading {
  /** UTC time the 3-hour period starts. */
  time: string;
  kp: number;
}

export interface WorldData {
  places(lat: number, lon: number, radiusKm: number): Promise<WorldPlace[]>;
  forecast(lat: number, lon: number): Promise<Forecast | null>;
  kp(): Promise<KpReading[]>;
  geocode(query: string): Promise<GeocodeResult[]>;
}

const USER_AGENT = 'LORE/0.4 (social adventure planner; https://lore-g8co.onrender.com)';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const WIKIDATA_TYPES: Record<string, PlaceKind> = {
  Q34038: 'waterfall',
  Q177380: 'hot_spring',
  Q83471: 'geyser',
  Q35666: 'glacier',
  Q8072: 'volcano',
  Q35509: 'cave',
  Q8502: 'mountain',
  Q46169: 'national_park',
  Q40080: 'beach',
  Q39715: 'lighthouse',
  Q33506: 'museum',
  Q207694: 'art_museum',
  Q839954: 'archaeological_site',
  Q23413: 'castle',
  Q109607: 'ruins',
  Q167346: 'botanical_garden',
};

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`${new URL(url).host} answered ${res.status}`), {
      status: res.status,
      retryAfter: res.headers.get('retry-after'),
    });
  }
  return (await res.json()) as T;
}

async function store(db: Db, key: string, data: unknown) {
  await db
    .insert(worldCache)
    .values({ key, data: data as object, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: worldCache.key, set: { data: data as object, fetchedAt: sql`now()` } });
}

/** Fresh cache hit, else load and store; if loading fails, fall back to stale data. */
async function cached<T>(db: Db, key: string, ttlMs: number, load: () => Promise<T>): Promise<T | null> {
  const [hit] = await db.select().from(worldCache).where(eq(worldCache.key, key)).limit(1);
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttlMs) return hit.data as T;
  try {
    const data = await load();
    await store(db, key, data);
    return data;
  } catch {
    return hit ? (hit.data as T) : null;
  }
}

let lastNominatimCall = 0;
async function nominatimSlot() {
  const wait = lastNominatimCall + 1100 - Date.now();
  lastNominatimCall = Date.now() + Math.max(0, wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 100);

// ---------------------------------------------------------------------------
// Places from Wikidata. Near home, a map search around the home cell; past 300 km,
// the notable index (the best-known places of each kind on Earth).

/** The near query (a map search around home) reaches this far. */
export const NEAR_BAND_MAX_KM = 300;

/**
 * The notable index: one Wikidata query per kind of place, each giving every one on
 * Earth with at least `minLinks` Wikipedia/Wikimedia pages (about 18,000 places in all).
 *
 * A map search can't reach past 300 km: in a dense area Wikidata has to look at every
 * geotagged thing in the circle (listed buildings, shops…) before it can pick out the
 * waterfalls, and it times out even 50 km wide around Frankfurt or London. One kind is a
 * short list it sifts in seconds, and the same list serves every home, so the whole
 * server asks these 16 queries once a month and a realm's far ring is a distance filter
 * in memory: every notable place in reach, on land anywhere around, islands included.
 *
 * Counts and the time to sift each kind were measured on query.wikidata.org (2026-11-18).
 * Cheapest first, so a new server has the first kinds within seconds; mountains last
 * (513,000 on Wikidata, about 30 s to sift).
 */
export const NOTABLE_KINDS: readonly { type: string; minLinks: number }[] = [
  { type: 'Q177380', minLinks: 2 }, // hot spring (129 with 3+ pages)
  { type: 'Q83471', minLinks: 2 }, // geyser (~75)
  { type: 'Q8072', minLinks: 3 }, // volcano (870)
  { type: 'Q46169', minLinks: 8 }, // national park (1,509)
  { type: 'Q167346', minLinks: 5 }, // botanical garden (555)
  { type: 'Q40080', minLinks: 5 }, // beach (610)
  { type: 'Q207694', minLinks: 8 }, // art museum (1,045)
  { type: 'Q23413', minLinks: 8 }, // castle (1,362)
  { type: 'Q35509', minLinks: 5 }, // cave (735)
  { type: 'Q35666', minLinks: 8 }, // glacier (932)
  { type: 'Q839954', minLinks: 8 }, // archaeological site (2,986)
  { type: 'Q34038', minLinks: 5 }, // waterfall (1,229)
  { type: 'Q39715', minLinks: 5 }, // lighthouse (942)
  { type: 'Q109607', minLinks: 5 }, // ruins (409)
  { type: 'Q33506', minLinks: 8 }, // museum (1,888)
  { type: 'Q8502', minLinks: 12 }, // mountain (3,423)
];
/** The index is asked again after this long. */
const NOTABLE_TTL = 30 * DAY;
/** A kind whose query failed is left alone this long (remembered in world_cache, so across restarts too). */
const NOTABLE_REST_MS = DAY;
const LABEL_LANGUAGES = 'en,mul,de,fr,es,it,nl,pt,pl,is,no,sv,da,fi';

const TYPES = Object.keys(WIKIDATA_TYPES)
  .map((q) => `wd:${q}`)
  .join(' ');

type Bindings = Record<string, { value: string } | undefined>[];

const notableKey = (kind: { type: string; minLinks: number }) => `places:notable:${kind.type}:${kind.minLinks}`;

const notableQuery = (kind: { type: string; minLinks: number }) => `SELECT ?item ?itemLabel ?type ?loc ?links WHERE {
  ?item wdt:P31 wd:${kind.type} ; wikibase:sitelinks ?links .
  FILTER(?links >= ${kind.minLinks})
  ?item wdt:P625 ?loc .
  BIND(wd:${kind.type} AS ?type)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGUAGES}". }
}`;

/** An Earth coordinate from a WKT point ("Point(lon lat)"); null on another globe (Mars has volcanoes too). */
function earthPoint(wkt: string): { lat: number; lon: number } | null {
  const m = /^Point\(([-\d.eE+]+) ([-\d.eE+]+)\)$/.exec(wkt.trim());
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function toPlaces(bindings: Bindings): WorldPlace[] {
  const seen = new Set<string>();
  const places: WorldPlace[] = [];
  for (const b of bindings) {
    const id = b.item?.value.split('/').pop() ?? '';
    const name = b.itemLabel?.value ?? '';
    const kind = WIKIDATA_TYPES[b.type?.value.split('/').pop() ?? ''];
    // Unlabelled items come back as their Q-number: not worth a journey.
    if (!id || !kind || seen.has(id) || /^Q\d+$/.test(name)) continue;
    const at = b.loc ? earthPoint(b.loc.value) : { lat: Number(b.lat?.value), lon: Number(b.lon?.value) };
    if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon)) continue;
    seen.add(id);
    const links = b.links ? Number(b.links.value) : NaN;
    places.push({
      id,
      name,
      kind,
      lat: Math.round(at.lat * 1e5) / 1e5,
      lon: Math.round(at.lon * 1e5) / 1e5,
      ...(Number.isFinite(links) && { sitelinks: links }),
    });
  }
  return places;
}

/** Throttled or blocked by Wikidata: wait, don't count it against the query. */
const throttled = (e: unknown) => {
  const status = (e as { status?: number }).status;
  return status === 429 || status === 403;
};

/** How long to leave Wikidata alone: what it asked (Retry-After), else a minute; a block (403) an hour at least. */
export function backOffMs(status: number, retryAfter: string | null | undefined, now = Date.now()): number {
  let asked = NaN;
  if (retryAfter) asked = /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
  const fallback = status === 403 ? HOUR : 60_000;
  const wait = Number.isFinite(asked) && asked > 0 ? asked : fallback;
  return Math.min(DAY, Math.max(status === 403 ? HOUR : 5_000, wait));
}

/**
 * Wikidata's query service, shared by every reading on this server. It allows each
 * client about a minute of query time per minute; when it answers 429 (or 403) every
 * query waits out its Retry-After (meanwhile the near query falls back to the cache).
 */
function wikidataClient() {
  let pausedUntil = 0;
  return {
    paused: () => Date.now() < pausedUntil,
    async sparql(query: string, timeoutMs: number): Promise<Bindings> {
      if (Date.now() < pausedUntil) throw Object.assign(new Error('Wikidata asked us to wait'), { status: 429 });
      try {
        const body = await fetchJson<{ results: { bindings: Bindings } }>(
          'https://query.wikidata.org/sparql',
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json' },
            body: new URLSearchParams({ query }),
          },
          timeoutMs,
        );
        return body.results.bindings;
      } catch (e) {
        if (throttled(e)) {
          const { status, retryAfter } = e as { status: number; retryAfter?: string | null };
          pausedUntil = Math.max(pausedUntil, Date.now() + backOffMs(status, retryAfter));
        }
        throw e;
      }
    },
  };
}

/** world_cache rows, remembered in memory (only this server writes them). For the few notable-index rows. */
function rememberedRows(db: Db) {
  const memo = new Map<string, { data: unknown; at: number } | null>();
  return {
    async read<T>(key: string): Promise<{ data: T; at: number } | null> {
      if (!memo.has(key)) {
        const [hit] = await db.select().from(worldCache).where(eq(worldCache.key, key)).limit(1);
        if (!memo.has(key)) memo.set(key, hit ? { data: hit.data, at: hit.fetchedAt.getTime() } : null);
      }
      return memo.get(key) as { data: T; at: number } | null;
    },
    async write(key: string, data: unknown) {
      await store(db, key, data);
      memo.set(key, { data, at: Date.now() });
    },
  };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });

/** Whichever comes first: the task, or `ms` passing (the task keeps going). */
async function within(task: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([task, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

/**
 * The real world, from open data. `farWaitMs`: how long a reading on a new server (no
 * notable index yet) waits for its first kinds; the rest keep loading for the next reading.
 */
export function openDataWorld(db: Db, { farWaitMs = 25_000 }: { farWaitMs?: number } = {}): WorldData {
  const wikidata = wikidataClient();
  const rows = rememberedRows(db);

  async function nearPlaces(cellLat: number, cellLon: number, radiusKm: number): Promise<WorldPlace[]> {
    const band = Math.min(NEAR_BAND_MAX_KM, Math.ceil((radiusKm + 40) / 100) * 100);
    const query = `SELECT ?item ?itemLabel ?type ?lat ?lon WHERE {
        VALUES ?type { ${TYPES} }
        SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${cellLon} ${cellLat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${band}" . }
        ?item wdt:P31 ?type .
        BIND(geof:latitude(?loc) AS ?lat) BIND(geof:longitude(?loc) AS ?lon)
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,is,de,fr,es,no,sv,da". }
      } LIMIT 2500`;
    const data = await cached(db, `places:${cellLat}:${cellLon}:${band}`, 30 * DAY, async () =>
      toPlaces(await wikidata.sparql(query, 60_000)),
    );
    return data ?? [];
  }

  /**
   * Fills in the notable index, one kind at a time. A query that fails puts its kind to
   * rest for a day and ends the round (Wikidata may be struggling; the next reading
   * goes on from there). After each query, a rest as long as it took: the index uses at
   * most half of Wikidata's budget for us, and near queries keep the other half.
   */
  async function notableRound() {
    for (const kind of NOTABLE_KINDS) {
      const key = notableKey(kind);
      const have = await rows.read<WorldPlace[]>(key);
      if (have && Date.now() - have.at < NOTABLE_TTL) continue;
      const failed = await rows.read(`${key}:failed`);
      if (failed && Date.now() - failed.at < NOTABLE_REST_MS) continue;
      if (wikidata.paused()) return;
      const started = Date.now();
      let places: WorldPlace[];
      try {
        places = toPlaces(await wikidata.sparql(notableQuery(kind), 65_000));
      } catch (e) {
        if (!throttled(e)) await rows.write(`${key}:failed`, { error: String(e) });
        return;
      }
      await rows.write(key, places);
      await sleep(Date.now() - started);
    }
  }
  /** One round at a time for the whole server: a kind is never asked for twice at once. */
  let round: Promise<void> | null = null;
  const refreshNotable = () =>
    (round ??= notableRound()
      .catch(() => {})
      .finally(() => (round = null)));

  async function notablePlaces(): Promise<WorldPlace[]> {
    const read = () => Promise.all(NOTABLE_KINDS.map((kind) => rows.read<WorldPlace[]>(notableKey(kind))));
    let lists = await read();
    if (lists.some((list) => !list || Date.now() - list.at >= NOTABLE_TTL)) {
      const refresh = refreshNotable();
      // A new server knows no kind yet: wait a little for the first ones. Otherwise go
      // with what's known (if old) and let the refresh land for the next reading.
      if (lists.every((list) => !list)) {
        await within(refresh, farWaitMs);
        lists = await read();
      }
    }
    return lists.flatMap((list) => list?.data ?? []);
  }

  return {
    async places(lat, lon, radiusKm) {
      // The near query: one per ~50 km cell and radius band (up to 300 km), kept for 30
      // days. A wider realm adds every notable place in reach from the index.
      const cellLat = Math.round(lat * 2) / 2;
      const cellLon = Math.round(lon * 2) / 2;
      const [nearby, notable] = await Promise.all([
        nearPlaces(cellLat, cellLon, radiusKm),
        radiusKm > NEAR_BAND_MAX_KM ? notablePlaces() : Promise.resolve([]),
      ]);
      // Merge, one entry per Wikidata item (a near place the index knows gets its notability).
      const byId = new Map<string, WorldPlace>(nearby.map((place) => [place.id, place]));
      for (const place of notable) {
        if (distanceKm(lat, lon, place.lat, place.lon) > radiusKm) continue;
        const known = byId.get(place.id);
        byId.set(place.id, known ? { ...known, sitelinks: place.sitelinks } : place);
      }
      return [...byId.values()];
    },

    async forecast(lat, lon) {
      const key = `weather:${lat.toFixed(1)}:${lon.toFixed(1)}`;
      return cached(db, key, HOUR, async () => {
        const params = new URLSearchParams({
          latitude: lat.toFixed(3),
          longitude: lon.toFixed(3),
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset',
          hourly: 'cloud_cover',
          wind_speed_unit: 'ms',
          forecast_days: '8',
          timezone: 'auto',
        });
        const f = await fetchJson<{
          timezone: string;
          utc_offset_seconds: number;
          daily: Record<string, (string | number)[]>;
          hourly: { time: string[]; cloud_cover: number[] };
        }>(`https://api.open-meteo.com/v1/forecast?${params}`);
        const cloudAt = new Map(f.hourly.time.map((t, i) => [t, f.hourly.cloud_cover[i] ?? 100]));
        const hourKey = (date: string, hour: number, dayOffset = 0) => {
          const d = new Date(`${date}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + dayOffset);
          return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
        };
        const days: DayWeather[] = (f.daily.time as string[]).map((date, i) => {
          const sunrise = String(f.daily.sunrise?.[i] ?? `${date}T08:00`);
          const sunriseHour = Number(sunrise.slice(11, 13));
          const night = [21, 22, 23].map((h) => cloudAt.get(hourKey(date, h))).concat([0, 1, 2, 3].map((h) => cloudAt.get(hourKey(date, h, 1))));
          const dawn = [sunriseHour - 1, sunriseHour, sunriseHour + 1].map((h) => cloudAt.get(hourKey(date, h)));
          return {
            date,
            code: Number(f.daily.weather_code?.[i] ?? 0),
            tMax: Number(f.daily.temperature_2m_max?.[i] ?? 0),
            tMin: Number(f.daily.temperature_2m_min?.[i] ?? 0),
            precip: Number(f.daily.precipitation_sum?.[i] ?? 0),
            windMax: Number(f.daily.wind_speed_10m_max?.[i] ?? 0),
            sunrise,
            sunset: String(f.daily.sunset?.[i] ?? `${date}T17:00`),
            cloudNight: average(night.filter((c): c is number => c !== undefined)),
            cloudDawn: average(dawn.filter((c): c is number => c !== undefined)),
          };
        });
        return { timeZone: f.timezone, utcOffsetSeconds: f.utc_offset_seconds, days };
      });
    },

    async kp() {
      const data = await cached(db, 'kp', HOUR, async () => {
        const rows = await fetchJson<{ time_tag: string; kp: number }[] | (string | number)[][]>(
          'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
        );
        // Newer format: array of objects. Older: header row then arrays.
        return rows
          .map((r) =>
            Array.isArray(r)
              ? { time: String(r[0]), kp: Number(r[1]) }
              : { time: r.time_tag, kp: Number(r.kp) },
          )
          .filter((r) => /^\d{4}-\d{2}-\d{2}/.test(r.time) && Number.isFinite(r.kp))
          .map((r) => ({ time: `${r.time.replace(' ', 'T').slice(0, 19)}Z`, kp: r.kp }));
      });
      return data ?? [];
    },

    async geocode(query) {
      const q = query.trim().toLowerCase();
      // v3 key: labels are town-level (never a street or a house) and carry the country (ISO-2,
      // upper case) that the Loracle needs; rows cached under older keys had neither.
      const data = await cached(db, `geocode:en:v3:${q}`, 30 * DAY, async () => {
        await nominatimSlot();
        const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '1', 'accept-language': 'en' });
        const rows = await fetchJson<{ display_name: string; lat: string; lon: string; address?: NominatimAddress }[]>(
          `https://nominatim.openstreetmap.org/search?${params}`,
        );
        const seen = new Set<string>();
        const out: GeocodeResult[] = [];
        for (const r of rows) {
          const label = realmLabel(r.display_name, r.address);
          if (!label || seen.has(label)) continue;
          seen.add(label);
          const cc = r.address?.country_code;
          out.push({
            label,
            lat: Number(r.lat),
            lon: Number(r.lon),
            country: cc && /^[a-z]{2}$/i.test(cc) ? cc.toUpperCase() : null,
          });
        }
        return out;
      });
      return data ?? [];
    },
  };
}

/** The parts of a Nominatim address (addressdetails=1) that name a place. */
interface NominatimAddress {
  country_code?: string;
  country?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  state?: string;
  region?: string;
  county?: string;
  road?: string;
  house_number?: string;
  postcode?: string;
}

/**
 * A place's label at town level: "Reykjavík, Capital Region, Iceland". A street, a house number or a
 * postcode is never part of it (a house result becomes its town); a street with no town is dropped
 * (null). Places that are not in a town (a park, an island, a mountain) keep their own name.
 */
export function realmLabel(displayName: string, a: NominatimAddress | undefined): string | null {
  const town = a?.city ?? a?.town ?? a?.village ?? a?.hamlet ?? a?.municipality ?? null;
  if (town) {
    const parts = [town, a?.state ?? a?.region ?? a?.county, a?.country].filter((x): x is string => !!x?.trim());
    return [...new Set(parts.map((x) => x.trim()))].join(', ');
  }
  if (a?.road || a?.house_number || a?.postcode) return null;
  const parts = displayName.split(',').map((x) => x.trim()).filter((x) => x && !/\d/.test(x));
  return parts.length ? parts.slice(0, 3).join(', ') : null;
}

/** Fraction of the moon that's lit (0 new … 1 full) at a given instant. */
export function moonIllumination(at: Date): number {
  const synodic = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((at.getTime() - knownNewMoon) / DAY) % synodic + synodic) % synodic;
  return (1 - Math.cos((2 * Math.PI * age) / synodic)) / 2;
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
