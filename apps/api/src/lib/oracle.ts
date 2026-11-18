// The Oracle engine: turns what LORE can see (sky, weather, notable places, free
// time, crews, ideas, memories) into a handful of concrete possible futures.
// Pure and seeded: the same inputs give the same reading, so a day's answer is
// stable and the engine is testable without the network.
import {
  type CrewRef,
  type EventCategory,
  type FutureKind,
  type FuturePlace,
  type Interest,
  NO_LIMIT_KM,
  type OracleMode,
} from '#shared';
import { distanceKm, moonIllumination, type DayWeather, type Forecast, type KpReading, type PlaceKind, type WorldPlace } from './world.ts';

export interface OracleInput {
  now: Date;
  seed: string;
  mode: OracleMode;
  home: { lat: number; lon: number };
  radiusKm: number;
  interests: Interest[];
  forecast: Forecast | null;
  kp: KpReading[];
  places: WorldPlace[];
  /** When the lore maker is already busy (personal calendar, plans they're in). */
  busy: { start: Date; end: Date }[];
  crews: CrewRef[];
  ideas: { id: string; title: string; category: EventCategory; whereNote: string | null; crewId: string | null }[];
  memories: { id: string; title: string; occurredOn: string; locationName: string | null }[];
  /** Places shown recently, so the stones don't repeat themselves. */
  recentPlaceIds: Set<string>;
}

export interface FutureDraft {
  kind: FutureKind;
  title: string;
  story: string;
  signs: string[];
  emoji: string;
  category: EventCategory;
  startsAt: string;
  endsAt: string | null;
  timeZone: string;
  place: FuturePlace | null;
  crew: CrewRef | null;
  ideaId: string | null;
  chapterId: string | null;
}

interface Candidate extends FutureDraft {
  template: string;
  interests: Interest[];
  score: number;
}

const PLACE_INTERESTS: Record<PlaceKind, Interest[]> = {
  waterfall: ['nature', 'photography', 'active'],
  hot_spring: ['water', 'cozy'],
  geyser: ['water', 'nature', 'photography'],
  glacier: ['nature', 'active', 'photography', 'road_trips'],
  volcano: ['nature', 'active', 'road_trips'],
  cave: ['nature', 'active'],
  mountain: ['active', 'nature'],
  national_park: ['nature', 'active', 'road_trips'],
  beach: ['water', 'nature', 'photography'],
  lighthouse: ['history', 'photography', 'road_trips'],
  museum: ['culture', 'history', 'cozy'],
  art_museum: ['culture', 'cozy'],
  archaeological_site: ['history'],
  castle: ['history', 'photography'],
  ruins: ['history', 'photography'],
  botanical_garden: ['nature', 'cozy'],
};

/** How the stones say it: 'For your love of …'. */
const LOVES: Record<Interest, string> = {
  nature: 'wild places',
  water: 'hot water',
  sky: 'the night sky',
  history: 'old stones',
  culture: 'art',
  photography: 'a good photo',
  road_trips: 'the open road',
  active: 'a good climb',
  cozy: 'slow days',
  social: 'your people',
};

const WILD: Set<PlaceKind> = new Set(['waterfall', 'glacier', 'volcano', 'cave', 'mountain', 'national_park', 'geyser']);
const DARK_SPOTS: Set<PlaceKind> = new Set(['lighthouse', 'volcano', 'glacier', 'mountain', 'national_park', 'beach', 'waterfall']);
const DAWN_SPOTS: Set<PlaceKind> = new Set(['lighthouse', 'mountain', 'volcano', 'beach', 'waterfall', 'glacier']);
const ANCIENT: Set<PlaceKind> = new Set(['archaeological_site', 'castle', 'ruins', 'lighthouse']);
const MUSES: Set<PlaceKind> = new Set(['museum', 'art_museum', 'botanical_garden']);

/** Beyond this a place is a journey (a weekend or longer away), never a day out or an evening. */
const JOURNEY_KM = 250;
/** Beyond this a journey takes two nights. */
const LONG_JOURNEY_KM = 400;
/** Beyond this no road gets you there and back in a weekend: a far shore, by air, a week away. */
const FAR_SHORE_KM = 1500;
/** As far as a weekday evening out goes. */
const EVENING_KM = 60;

const JOURNEYS: { template: string; kinds: Set<PlaceKind>; emoji: string; score: number }[] = [
  { template: 'journey', kinds: new Set([...WILD, 'beach', 'lighthouse', 'hot_spring']), emoji: '🗺️', score: 5.5 },
  { template: 'pilgrimage', kinds: new Set([...ANCIENT, ...MUSES]), emoji: '🧳', score: 5 },
];

/** Rough hours on the road for a straight-line distance: roads wind (×1.3), about 80 km/h with stops. */
const roadHours = (km: number) => Math.max(1, Math.round((km * 1.3) / 80));
/** Rough hours in the air, about 800 km an hour. */
const flyHours = (km: number) => Math.max(1, Math.round(km / 800));
const FAR_SHORE_KINDS: Set<PlaceKind> = new Set([...WILD, 'beach', 'lighthouse', 'hot_spring', ...ANCIENT, ...MUSES]);

// ---------------------------------------------------------------------------
// Small helpers

function rngFrom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h << 13) | (h >>> 19);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const describe = (code: number) =>
  code >= 95
    ? 'Thunder in the air.'
    : code >= 71 && code <= 86
      ? 'Snow is coming.'
      : code >= 51
        ? 'Rain on the way.'
        : code >= 45
          ? 'Fog over everything.'
          : code === 0
            ? 'Clear and calm.'
            : 'Clouds drifting by.';

const isSnow = (d: DayWeather) => (d.code >= 71 && d.code <= 77) || d.code === 85 || d.code === 86;
const isWet = (d: DayWeather | null) => !!d && (d.precip >= 2 || d.code >= 51);
const isFair = (d: DayWeather | null) => !!d && d.precip < 1.5 && d.windMax < 14 && d.code < 51;

export function generateFutures(input: OracleInput): FutureDraft[] {
  const rng = rngFrom(input.seed);
  const tz = input.forecast?.timeZone ?? 'UTC';
  const offset = input.forecast?.utcOffsetSeconds ?? 0;
  const soonest = input.now.getTime() + 60 * 60 * 1000;

  /** A local wall-clock time on a local date, as an instant. */
  const at = (date: string, hhmm: string, plusDays = 0) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 1, d + plusDays, hh, mm) - offset * 1000);
  };
  const localTime = (wall: string) => wall.slice(11, 16);
  const dayName = (date: string) =>
    new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const free = (start: Date, end: Date) =>
    start.getTime() >= soonest && !input.busy.some((b) => b.start < end && b.end > start);

  // Days to consider: the forecast's, or the next week without weather.
  const days: { date: string; weather: DayWeather | null }[] = input.forecast?.days.length
    ? input.forecast.days.map((d) => ({ date: d.date, weather: d }))
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date(input.now.getTime() + i * 86_400_000);
        return { date: d.toISOString().slice(0, 10), weather: null };
      });

  const nearby = input.places
    .map((p) => ({ ...p, distance: distanceKm(input.home.lat, input.home.lon, p.lat, p.lon) }))
    .filter((p) => p.distance <= input.radiusKm);

  /** `notable`: only the best-known quarter (by Wikimedia pages), for places worth a journey. */
  const pickPlace = (kinds: Set<PlaceKind>, minKm = 0, maxKm = input.radiusKm, notable = false) => {
    const options = nearby.filter((p) => kinds.has(p.kind) && p.distance >= minKm && p.distance <= maxKm);
    if (!options.length) return null;
    const fresh = options.filter((p) => !input.recentPlaceIds.has(p.id));
    let pool = fresh.length ? fresh : options;
    if (notable) {
      pool = [...pool].sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0)).slice(0, Math.max(5, Math.ceil(pool.length / 4)));
    }
    return pool[Math.floor(rng() * pool.length)]!;
  };
  const shiftDate = (date: string, days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  /** Same-day futures stay within a day's reach, however wide the realm. */
  const dayReach = Math.min(JOURNEY_KM, input.radiusKm);
  const asPlace = (p: (typeof nearby)[number]): FuturePlace => ({
    name: p.name,
    kind: p.kind,
    lat: p.lat,
    lon: p.lon,
    distanceKm: Math.round(p.distance),
    wikidataId: p.id,
  });
  const crew = () => (input.crews.length ? input.crews[Math.floor(rng() * input.crews.length)]! : null);
  const weatherSigns = (w: DayWeather | null) =>
    w
      ? [
          `${Math.round(w.tMax)}°C`,
          w.precip < 0.5 ? 'Dry' : `${w.precip.toFixed(1)} mm ${isSnow(w) ? 'snow' : 'rain'}`,
          `Wind ${Math.round(w.windMax)} m/s`,
        ]
      : [];

  const candidates: Candidate[] = [];
  const add = (c: Omit<Candidate, 'score' | 'timeZone'> & { score: number }) => candidates.push({ ...c, timeZone: tz });

  const absLat = Math.abs(input.home.lat);
  const kpNeeded = absLat >= 63 ? 2 : absLat >= 60 ? 3 : absLat >= 55 ? 5 : 7;
  const kpFor = (date: string) => {
    const from = at(date, '20:00').getTime();
    const to = at(date, '03:00', 1).getTime();
    return input.kp.reduce((max, k) => {
      const t = Date.parse(k.time);
      return t >= from - 3 * 3_600_000 && t < to ? Math.max(max, k.kp) : max;
    }, 0);
  };

  for (const { date, weather: w } of days) {
    const weekend = isWeekend(date);
    const name = date === days[0]!.date ? 'tonight' : `${dayName(date)} night`;

    // --- Sky -----------------------------------------------------------------
    if (w) {
      const darkHours = (at(date, localTime(w.sunrise), 1).getTime() - at(date, localTime(w.sunset)).getTime()) / 3_600_000;
      const kp = kpFor(date);
      const start = at(date, '22:00');
      const end = at(date, '01:00', 1);
      const moon = Math.round(moonIllumination(start) * 100);
      if (darkHours >= 7 && kp >= kpNeeded && w.cloudNight <= 45 && free(start, end)) {
        const place = pickPlace(DARK_SPOTS, 12, Math.min(90, input.radiusKm));
        add({
          template: 'aurora',
          kind: 'interest',
          title: 'The Aurora Pilgrimage',
          story: `${name === 'tonight' ? 'Tonight' : `On ${name}`} the sky${place ? ` above ${place.name}` : ''} may burn green. Leave the city lights behind and look north.`,
          signs: [`Aurora forecast Kp ${kp.toFixed(1)}`, `${Math.round(w.cloudNight)}% cloud after dark`, `Moon ${moon}% lit`],
          emoji: '🌌',
          category: 'outdoor',
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          place: place ? asPlace(place) : null,
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: ['sky', 'photography', 'nature'],
          score: 6 + kp + (45 - w.cloudNight) / 15,
        });
      }
      if (darkHours >= 7 && w.cloudNight <= 30 && moon <= 45 && free(at(date, '22:30'), at(date, '00:30', 1))) {
        const place = pickPlace(DARK_SPOTS, 15, Math.min(80, input.radiusKm));
        add({
          template: 'stars',
          kind: 'interest',
          title: 'Night of a Thousand Stars',
          story: `A clear, dark ${name}: the moon is only ${moon}% lit. Lie back${place ? ` at ${place.name}` : ' somewhere far from streetlights'} and count what you can't see from town.`,
          signs: [`${Math.round(w.cloudNight)}% cloud after dark`, `Moon ${moon}% lit`],
          emoji: '✨',
          category: 'outdoor',
          startsAt: at(date, '22:30').toISOString(),
          endsAt: at(date, '00:30', 1).toISOString(),
          place: place ? asPlace(place) : null,
          crew: null,
          ideaId: null,
          chapterId: null,
          interests: ['sky', 'photography'],
          score: 4 + (30 - w.cloudNight) / 10,
        });
      }
      const sunrise = at(date, localTime(w.sunrise));
      const dawnStart = new Date(sunrise.getTime() - 45 * 60_000);
      if (w.cloudDawn <= 40 && free(dawnStart, new Date(sunrise.getTime() + 60 * 60_000))) {
        const place = pickPlace(DAWN_SPOTS, 0, Math.min(50, input.radiusKm));
        if (place) {
          add({
            template: 'dawn',
            kind: 'interest',
            title: `Dawn at ${place.name}`,
            story: `Be at ${place.name} before ${localTime(w.sunrise)} on ${dayName(date)}. Clear skies at sunrise are rare; this one is promised.`,
            signs: [`Sunrise ${localTime(w.sunrise)}`, `${Math.round(w.cloudDawn)}% cloud at dawn`],
            emoji: '🌅',
            category: 'outdoor',
            startsAt: dawnStart.toISOString(),
            endsAt: new Date(sunrise.getTime() + 60 * 60_000).toISOString(),
            place: asPlace(place),
            crew: null,
            ideaId: null,
            chapterId: null,
            interests: ['sky', 'photography'],
            score: 3 + (weekend ? 1.5 : 0) + (40 - w.cloudDawn) / 15,
          });
        }
      }
    }

    // --- Day trips (weekends) ----------------------------------------------------
    if (weekend && isFair(w) && free(at(date, '10:00'), at(date, '17:00'))) {
      const place = pickPlace(WILD, 10, dayReach);
      if (place) {
        add({
          template: 'expedition',
          kind: 'interest',
          title: `Into the Wild: ${place.name}`,
          story: `${dayName(date)} looks dry. ${place.name} is ${Math.round(place.distance)} km away, and pictures don't count. Go see it.`,
          signs: [...weatherSigns(w), "You're free"],
          emoji: '🧭',
          category: 'expedition',
          startsAt: at(date, '10:00').toISOString(),
          endsAt: at(date, '17:00').toISOString(),
          place: asPlace(place),
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: PLACE_INTERESTS[place.kind],
          score: 5 + (w ? (15 - w.windMax) / 5 : 0),
        });
      }
      const far = pickPlace(new Set([...WILD, 'lighthouse', 'beach'] as PlaceKind[]), Math.min(80, input.radiusKm * 0.6), dayReach);
      if (far && free(at(date, '08:00'), at(date, '20:00'))) {
        const stop = nearby
          .filter((p) => p.id !== far.id && p.distance < far.distance && distanceKm(p.lat, p.lon, far.lat, far.lon) < far.distance * 0.7)
          .sort((a, b) => a.distance - b.distance)[Math.floor(rng() * 3)];
        add({
          template: 'road',
          kind: 'interest',
          title: `The Long Road to ${far.name}`,
          story: `A whole free ${dayName(date)} and fair weather. Drive ${Math.round(far.distance)} km to ${far.name}${stop ? `, with a stop at ${stop.name} on the way` : ''}. Bring snacks and a playlist.`,
          signs: [...weatherSigns(w), "You're free all day"],
          emoji: '🚐',
          category: 'road_trip',
          startsAt: at(date, '08:00').toISOString(),
          endsAt: at(date, '20:00').toISOString(),
          place: asPlace(far),
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: ['road_trips', ...PLACE_INTERESTS[far.kind]],
          score: 4 + (far.distance > 100 ? 1 : 0),
        });
      }
      const ancient = pickPlace(ANCIENT, 0, dayReach);
      if (ancient) {
        add({
          template: 'ancients',
          kind: 'interest',
          title: `Echoes of the Ancients: ${ancient.name}`,
          story: `Walk where people stood long before you. ${ancient.name} is ${Math.round(ancient.distance)} km away, and ${dayName(date)} is free.`,
          signs: [...weatherSigns(w)],
          emoji: '🏛️',
          category: 'outdoor',
          startsAt: at(date, '11:00').toISOString(),
          endsAt: at(date, '15:00').toISOString(),
          place: asPlace(ancient),
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: PLACE_INTERESTS[ancient.kind],
          score: 3.5,
        });
      }
      const beach = pickPlace(new Set(['beach'] as PlaceKind[]), 0, dayReach);
      if (beach && w && w.tMax >= 8) {
        add({
          template: 'coast',
          kind: 'interest',
          title: `Salt Air at ${beach.name}`,
          story: `Salt air on ${dayName(date)}: ${beach.name}, ${Math.round(beach.distance)} km away. Shoes off if you dare.`,
          signs: [...weatherSigns(w)],
          emoji: '🌊',
          category: 'outdoor',
          startsAt: at(date, '12:00').toISOString(),
          endsAt: at(date, '15:00').toISOString(),
          place: asPlace(beach),
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: ['water', 'nature'],
          score: 3 + w.tMax / 10,
        });
      }
    }

    // --- Journeys: too far for a day, so a weekend (or a long one) away ------------
    // Home's forecast says nothing about a place 600 km off, so no weather signs.
    if (input.radiusKm > JOURNEY_KM && new Date(`${date}T12:00:00Z`).getUTCDay() === 6) {
      for (const j of JOURNEYS) {
        const place = pickPlace(j.kinds, JOURNEY_KM, Math.min(input.radiusKm, FAR_SHORE_KM), true);
        if (!place) continue;
        const nights = place.distance > LONG_JOURNEY_KM ? 2 : 1;
        // One night: Saturday to Sunday. Two: Friday to Sunday, else Saturday to Monday.
        const spans: [number, number][] = nights === 1 ? [[0, 1]] : [[-1, 1], [0, 2]];
        const span = spans.find(([from, to]) => free(at(date, '08:00', from), at(date, '20:00', to)));
        if (!span) continue;
        const first = dayName(shiftDate(date, span[0]));
        const last = dayName(shiftDate(date, span[1]));
        const km = Math.round(place.distance);
        const hours = roadHours(place.distance);
        const road =
          hours > 8
            ? `about ${hours} hours by road each way, so a train or a flight may serve you better`
            : `about ${hours} hours on the road each way`;
        const plan =
          nights === 1
            ? `Leave ${first} morning, sleep near it, and come home ${last} evening.`
            : `Go ${first}, stay two nights, and be home ${last} night.`;
        add({
          template: j.template,
          kind: 'interest',
          title: j.template === 'journey' ? `Beyond the Horizon: ${place.name}` : `Pilgrimage to ${place.name}`,
          story:
            j.template === 'journey'
              ? `${place.name} is ${km} km away, ${road}. Too far for a day, so make it a journey. ${plan}`
              : `Some places deserve more than an afternoon. ${place.name} is ${km} km away, ${road}. ${plan}`,
          signs: [
            `About ${hours} h each way by road`,
            nights === 1 ? 'One night away' : 'Two nights away',
            `You're free ${first} to ${last}`,
            'Check the weather there before you go',
          ],
          emoji: j.emoji,
          category: j.template === 'journey' && WILD.has(place.kind) ? 'expedition' : 'road_trip',
          startsAt: at(date, '08:00', span[0]).toISOString(),
          endsAt: at(date, '20:00', span[1]).toISOString(),
          place: asPlace(place),
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: ['road_trips', ...PLACE_INTERESTS[place.kind]],
          score: j.score,
        });
      }
    }

    // --- A far shore: past where roads reach in a weekend. Fly, and give it a week. -----
    if (input.radiusKm > FAR_SHORE_KM && new Date(`${date}T12:00:00Z`).getUTCDay() === 6) {
      const place = pickPlace(FAR_SHORE_KINDS, FAR_SHORE_KM, input.radiusKm, true);
      // Leaving needs a free weekend; the week after is yours to clear.
      if (place && free(at(date, '08:00'), at(date, '20:00', 1))) {
        const km = Math.round(place.distance).toLocaleString('en');
        const hours = flyHours(place.distance);
        const first = dayName(date);
        const wild = WILD.has(place.kind) || place.kind === 'beach' || place.kind === 'hot_spring';
        const stories = wild
          ? [
              `${place.name} is ${km} km from home. No road gets you there in a weekend, so take to the air. Fly out ${first}, give it a week, and let the place decide the rest.`,
              `The map runs out of roads long before ${place.name}. ${km} km. Pack light, fly ${first}, and do not come home the same.`,
            ]
          : [
              `Across the sea, ${place.name} has waited a long time for you. ${km} km. Fly out ${first}, give it a week, and come home with a story nobody else has.`,
              `Some places are worth crossing the world for. ${place.name} is one: ${km} km away. Fly ${first}. Stay a week. Listen.`,
            ];
        add({
          template: 'far_shore',
          kind: 'interest',
          title: `A Far Shore: ${place.name}`,
          story: stories[Math.floor(rng() * stories.length)]!,
          signs: [
            `About ${hours} h in the air each way`,
            'A week away: ask for the time off',
            'Passport, and check visas and vaccines',
            'Check the season there before you go',
          ],
          emoji: '🧭',
          category: 'expedition',
          startsAt: at(date, '08:00').toISOString(),
          endsAt: at(date, '20:00', 8).toISOString(),
          place: asPlace(place),
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: PLACE_INTERESTS[place.kind],
          // Whoever opens the realm to the whole world wants to be sent somewhere far.
          score: input.radiusKm >= NO_LIMIT_KM ? 6.5 : 5.3,
        });
      }
    }

    // --- Any weather -------------------------------------------------------------
    const soakStart = weekend ? '15:00' : '19:00';
    const soakEnd = weekend ? '17:30' : '21:30';
    if (free(at(date, soakStart), at(date, soakEnd))) {
      const spring = pickPlace(new Set(['hot_spring'] as PlaceKind[]), 0, Math.min(90, input.radiusKm));
      if (spring) {
        const cold = w ? w.tMax < 5 : false;
        add({
          template: 'soak',
          kind: 'interest',
          title: `The Hot Water Ritual at ${spring.name}`,
          story: `${w ? describe(w.code) : ''} ${dayName(date)} is the perfect excuse to sink into the warm water at ${spring.name}.`.trim(),
          signs: [...weatherSigns(w), ...(cold || isWet(w) ? ['The colder, the better'] : [])],
          emoji: '♨️',
          category: 'gathering',
          startsAt: at(date, soakStart).toISOString(),
          endsAt: at(date, soakEnd).toISOString(),
          place: asPlace(spring),
          crew: crew(),
          ideaId: null,
          chapterId: null,
          interests: ['water', 'cozy'],
          score: 3 + (cold ? 1.5 : 0) + (isWet(w) ? 1 : 0),
        });
      }
    }
    const museStart = weekend ? '13:00' : '17:30';
    const museEnd = weekend ? '16:00' : '19:30';
    if (free(at(date, museStart), at(date, museEnd))) {
      const muse = pickPlace(MUSES, 0, Math.min(weekend ? JOURNEY_KM : EVENING_KM, input.radiusKm));
      if (muse) {
        add({
          template: 'muses',
          kind: 'interest',
          title: `Shelter of the Muses: ${muse.name}`,
          story: `${w ? describe(w.code) : ''} Spend ${dayName(date)} ${weekend ? 'afternoon' : 'evening'} at ${muse.name} and come out with something new in your head. (Check the opening hours.)`.trim(),
          signs: [...weatherSigns(w)],
          emoji: '🎨',
          category: 'creative',
          startsAt: at(date, museStart).toISOString(),
          endsAt: at(date, museEnd).toISOString(),
          place: asPlace(muse),
          crew: null,
          ideaId: null,
          chapterId: null,
          interests: PLACE_INTERESTS[muse.kind],
          score: 2.5 + (isWet(w) ? 2 : 0),
        });
      }
    }
    if (!weekend && input.crews.length && isWet(w) && free(at(date, '19:00'), at(date, '23:00'))) {
      const c = crew()!;
      add({
        template: 'gathering',
        kind: 'interest',
        title: `The Gathering: ${c.emoji} ${c.name}`,
        story: `${describe(w!.code)} ${dayName(date)} evening. Call ${c.name} over: games, food, stories. Rainy nights make the best lore.`,
        signs: [...weatherSigns(w), "You're free"],
        emoji: '🔥',
        category: 'gathering',
        startsAt: at(date, '19:00').toISOString(),
        endsAt: at(date, '23:00').toISOString(),
        place: null,
        crew: c,
        ideaId: null,
        chapterId: null,
        interests: ['social', 'cozy'],
        score: 3,
      });
    }
  }

  // --- The Idea Vault and memories: once each, on the best free weekend day ------
  const goodWeekend = days.find(
    ({ date, weather }) => isWeekend(date) && (weather ? isFair(weather) : true) && free(at(date, '11:00'), at(date, '17:00')),
  );
  if (goodWeekend && input.ideas.length) {
    const idea = input.ideas[Math.floor(rng() * input.ideas.length)]!;
    const c = idea.crewId ? (input.crews.find((x) => x.id === idea.crewId) ?? null) : crew();
    add({
      template: 'vault',
      kind: 'idea',
      title: `The Vault Opens: ${idea.title}`,
      story: `“${idea.title}” has waited in the vault long enough. ${dayName(goodWeekend.date)} is free${goodWeekend.weather ? ' and the weather agrees' : ''}. Make it real.`,
      signs: [...weatherSigns(goodWeekend.weather), 'From your Idea Vault'],
      emoji: '📜',
      category: idea.category,
      startsAt: at(goodWeekend.date, '11:00').toISOString(),
      endsAt: at(goodWeekend.date, '17:00').toISOString(),
      place: null,
      crew: c,
      ideaId: idea.id,
      chapterId: null,
      interests: ['social'],
      score: 5,
    });
  }
  // Echoes prefer a different day from the vault's, so both can be dealt.
  const echoFree = ({ date }: { date: string }) => isWeekend(date) && free(at(date, '12:00'), at(date, '17:00'));
  const echoDay =
    days.find((d) => echoFree(d) && d.date !== (input.ideas.length ? goodWeekend?.date : undefined)) ?? days.find(echoFree);
  if (echoDay && input.memories.length) {
    const memory = input.memories[Math.floor(rng() * input.memories.length)]!;
    const years = Math.max(1, new Date(input.now).getUTCFullYear() - Number(memory.occurredOn.slice(0, 4)));
    add({
      template: 'echo',
      kind: 'memory',
      title: `Echo of ${memory.occurredOn.slice(0, 4)}: ${memory.title}`,
      story: `${years} year${years === 1 ? '' : 's'} ago this week: “${memory.title}”${memory.locationName ? ` at ${memory.locationName}` : ''}. Do it again and it becomes a tradition.`,
      signs: ['From your Lorebook', `${dayName(echoDay.date)} is free`],
      emoji: '🕯️',
      category: 'tradition',
      startsAt: at(echoDay.date, '12:00').toISOString(),
      endsAt: at(echoDay.date, '17:00').toISOString(),
      place: null,
      crew: crew(),
      ideaId: null,
      chapterId: memory.id,
      interests: ['social'],
      score: 4.5,
    });
  }

  return deal(candidates, input, rng);
}

/** Choose three: varied in kind, day and place, shaped by the reading's mode. */
function deal(candidates: Candidate[], input: OracleInput, rng: () => number): FutureDraft[] {
  const mine = new Set(input.interests);
  const matches = (c: Candidate) => c.interests.filter((i) => mine.has(i)).length;
  const ranked = (pool: Candidate[], interestWeight: number) =>
    pool
      .map((c) => ({ c, s: c.score + matches(c) * interestWeight + rng() * 3 }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);

  const chosen: Candidate[] = [];
  // A far shore lasts a week, but it's a different life, not a clash with Tuesday's evening swim:
  // for spacing the reading out it only claims its departure weekend.
  const until = (c: Candidate) => {
    const end = Date.parse(c.endsAt ?? c.startsAt);
    return c.template === 'far_shore' ? Math.min(end, Date.parse(c.startsAt) + 2 * 86_400_000) : end;
  };
  const fits = (c: Candidate) =>
    !chosen.some(
      (x) =>
        x.template === c.template ||
        (x.place && c.place && x.place.wikidataId === c.place.wikidataId) ||
        (Date.parse(x.startsAt) < until(c) && Date.parse(c.startsAt) < until(x)),
    );
  const take = (pool: Candidate[], n: number, kind?: FutureKind) => {
    for (const c of pool) {
      if (chosen.length >= 3 || n <= 0) break;
      if (!fits(c)) continue;
      chosen.push(kind && c.kind === 'interest' ? { ...c, kind } : c);
      n--;
    }
  };

  const followers = ranked(candidates.filter((c) => matches(c) > 0 || c.kind !== 'interest'), 3);
  const strangers = ranked(candidates.filter((c) => matches(c) === 0), 0);
  if (input.mode === 'wild' || mine.size === 0) {
    take(strangers.length ? strangers : ranked(candidates, 0), 3, 'wildcard');
  } else if (input.mode === 'mine') {
    take(followers, 3);
  } else {
    take(followers, 2);
    take(strangers, 1, 'wildcard');
  }
  // Not enough of the right sort: fill up from everything.
  take(ranked(candidates, 1), 3 - chosen.length);

  return chosen.map((c) => {
    const matched = [...new Set(c.interests.filter((i) => mine.has(i)))].map((i) => LOVES[i]);
    const signs = [...c.signs];
    if (c.kind === 'wildcard') signs.push('A wildcard: outside your usual');
    else if (matched.length) signs.push(`For your love of ${matched.slice(0, 2).join(' & ')}`);
    const { template: _t, interests: _i, score: _s, ...draft } = c;
    return { ...draft, signs };
  });
}
