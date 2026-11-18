// The world as the Oracle sees it, from free open-data services:
//   places   Wikidata (notable waterfalls, hot springs, peaks, ruins, museums…)
//   weather  Open-Meteo (7-day forecast, cloud cover, sunrise/sunset)
//   aurora   NOAA SWPC planetary Kp forecast
//   geocode  Nominatim (OpenStreetMap), for typing in your home area
// Every answer is cached in `world_cache`; when a service is down the last known
// answer is used, and with nothing at all the Oracle works with what it has.
// Each service's usage policy is respected: an identifying User-Agent, caching,
// and at most one Nominatim request per second.
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
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Fresh cache hit, else load and store; if loading fails, fall back to stale data. */
async function cached<T>(db: Db, key: string, ttlMs: number, load: () => Promise<T>): Promise<T | null> {
  const [hit] = await db.select().from(worldCache).where(eq(worldCache.key, key)).limit(1);
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttlMs) return hit.data as T;
  try {
    const data = await load();
    await db
      .insert(worldCache)
      .values({ key, data: data as object, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: worldCache.key, set: { data: data as object, fetchedAt: sql`now()` } });
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

export function openDataWorld(db: Db): WorldData {
  return {
    async places(lat, lon, radiusKm) {
      // One query per ~50 km cell and radius band, kept for 30 days.
      const cellLat = Math.round(lat * 2) / 2;
      const cellLon = Math.round(lon * 2) / 2;
      const band = Math.min(300, Math.ceil((radiusKm + 40) / 100) * 100);
      const types = Object.keys(WIKIDATA_TYPES)
        .map((q) => `wd:${q}`)
        .join(' ');
      const query = `SELECT ?item ?itemLabel ?type ?lat ?lon WHERE {
        VALUES ?type { ${types} }
        SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${cellLon} ${cellLat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${band}" . }
        ?item wdt:P31 ?type .
        BIND(geof:latitude(?loc) AS ?lat) BIND(geof:longitude(?loc) AS ?lon)
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,is,de,fr,es,no,sv,da". }
      } LIMIT 2500`;
      const data = await cached(db, `places:${cellLat}:${cellLon}:${band}`, 30 * DAY, async () => {
        const body = await fetchJson<{ results: { bindings: Record<string, { value: string }>[] } }>(
          'https://query.wikidata.org/sparql',
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json' },
            body: new URLSearchParams({ query }),
          },
          60_000,
        );
        const seen = new Set<string>();
        const places: WorldPlace[] = [];
        for (const b of body.results.bindings) {
          const id = b.item?.value.split('/').pop() ?? '';
          const name = b.itemLabel?.value ?? '';
          const kind = WIKIDATA_TYPES[b.type?.value.split('/').pop() ?? ''];
          // Unlabelled items come back as their Q-number: not worth a journey.
          if (!id || !kind || seen.has(id) || /^Q\d+$/.test(name)) continue;
          seen.add(id);
          places.push({ id, name, kind, lat: Number(b.lat!.value), lon: Number(b.lon!.value) });
        }
        return places;
      });
      return data ?? [];
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
      const data = await cached(db, `geocode:en:${q}`, 30 * DAY, async () => {
        await nominatimSlot();
        const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '0', 'accept-language': 'en' });
        const rows = await fetchJson<{ display_name: string; lat: string; lon: string }[]>(
          `https://nominatim.openstreetmap.org/search?${params}`,
        );
        return rows.map((r) => ({
          label: r.display_name.split(',').slice(0, 3).map((s) => s.trim()).join(', '),
          lat: Number(r.lat),
          lon: Number(r.lon),
        }));
      });
      return data ?? [];
    },
  };
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
