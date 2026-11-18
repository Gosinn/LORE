import { useEffect, useSyncExternalStore } from 'react';
import { rollCrazy, startCrazy, stopCrazy } from './crazy.ts';

/**
 * LORE's looks and worlds (docs/DECISIONS.md D34).
 *
 * One look, `lore`: the Loracle's own kit (stone buttons, wells, slabs) everywhere (styles/lore.css). The variety
 * is the world behind it: one of seven night worlds, and one day world, the green hills (styles/worlds.css).
 * What <html> carries, and what the CSS reads:
 *   data-theme="lore"                  the look
 *   data-world="<WorldId>"             the world on screen now (a night world, or green-hills by day)
 *   data-daylight="night" | "day"      which half of the day the app is in
 *   data-cards="vellum"                not set: light vellum cards by day, ready in lore.css, not offered yet
 *                                      (the owner picked stone; DECISIONS Q10)
 * The choices live on the device (localStorage), not on the account (ROADMAP: sync worlds across devices).
 * index.html wears them before the first paint with a small copy of this logic (a test keeps the two equal).
 *
 * The older looks are retired, not deleted (owner, 2026-11-18: "dont delete them, just retire them ... i might
 * change my mind"): their CSS and code stay as they were. To bring one back, move its name from RETIRED_THEMES into
 * THEMES (Profile lists THEMES when there is more than one), and set data-theme from index.html's boot script
 * instead of the fixed "lore", or every start of the returned look flashes the worlds first.
 */
export const THEMES = ['lore'] as const;
export const RETIRED_THEMES = ['map', 'system', 'light', 'dark', 'crazy'] as const;

export type ActiveTheme = (typeof THEMES)[number];
export type RetiredTheme = (typeof RETIRED_THEMES)[number];
export type ThemeChoice = ActiveTheme | RetiredTheme;

export const DEFAULT_THEME: ActiveTheme = 'lore';

export const THEME_LABELS: Record<ThemeChoice, string> = {
  lore: 'LORE',
  map: 'Treasure Map',
  system: 'Match device',
  light: 'Paper',
  dark: 'Campfire',
  crazy: 'Crazy',
};

// ------------------------------------------------------------------------------------------- worlds

/** The night worlds, in the order Profile shows them. The first is everyone's until they pick. */
export const NIGHT_WORLDS = [
  'black-star-sky',
  'night-map',
  'midnight-vellum',
  'scroll',
  'treasure-map',
  'mountain-range',
  'northern-lights',
] as const;
export const DAY_WORLDS = ['green-hills'] as const;

export type NightWorld = (typeof NIGHT_WORLDS)[number];
export type DayWorld = (typeof DAY_WORLDS)[number];
export type WorldId = NightWorld | DayWorld;

export const DEFAULT_WORLD: NightWorld = 'black-star-sky';
export const DAY_WORLD: DayWorld = 'green-hills';

export const WORLD_LABELS: Record<WorldId, string> = {
  'black-star-sky': 'Black star sky',
  'night-map': 'Night map',
  'midnight-vellum': 'Midnight vellum',
  scroll: 'Scroll',
  'treasure-map': 'Treasure map',
  'mountain-range': 'Mountain range',
  'northern-lights': 'Northern lights',
  'green-hills': 'The green hills',
};

/**
 * What the browser bar wears in each world: the colour along the art's top edge (--world-top in lore.css), so
 * the bar runs straight into the sky. AppShell copies --world-top to the bar on every navigation, so the two
 * never disagree. index.html's boot script holds the same table. (Each world's base colour, behind the art
 * while it loads, is --world-bg in worlds.css and lore.css.)
 */
export const WORLD_BAR: Record<WorldId, string> = {
  'black-star-sky': '#030409',
  'night-map': '#241b14',
  'midnight-vellum': '#1f1a2c',
  scroll: '#2a1708',
  'treasure-map': '#14201e',
  'mountain-range': '#060a18',
  'northern-lights': '#03060e',
  'green-hills': '#1a3a6e',
};

/** When it's day: the phone's own light/dark setting, the real sun where the Lorer stands, or fixed. */
export const DAYLIGHTS = ['phone', 'sun', 'night', 'day'] as const;
export type DaylightChoice = (typeof DAYLIGHTS)[number];
export const DEFAULT_DAYLIGHT: DaylightChoice = 'phone';

export const DAYLIGHT_LABELS: Record<DaylightChoice, string> = {
  phone: 'Follow my phone',
  sun: 'Follow the sun where I stand',
  night: 'Always night',
  day: 'Always day',
};

export type Half = 'day' | 'night';

/** Where the Lorer stands, to one decimal (about 10 km): plenty for the sun, and no more than it needs. */
export interface SunPoint {
  lat: number;
  lon: number;
}

// ------------------------------------------------------------------------------------------ storage

const KEY = 'lore.theme';
const WORLD_KEY = 'lore.world';
const DAYLIGHT_KEY = 'lore.daylight';
const SUN_KEY = 'lore.sun';
/** The sun's last answer and until when it holds: index.html reads it before the first paint. */
const SUN_NOW_KEY = 'lore.sunNow';
/**
 * "1" while someone is signed in on this device (World.tsx keeps it). Without it a start wears the front door's
 * world, as Welcome does: a new install or a signed-out start opens on '/', waits for /auth/me and lands on
 * Welcome, and must not show the day world for those seconds first. Only a hint for the first paint.
 */
const IN_KEY = 'lore.in';
/** How many sunrises and sunsets the boot script gets: about a week, so a start days later still knows. */
const SUN_TURNS = 14;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

const isOffered = (v: string | null): v is ActiveTheme => (THEMES as readonly string[]).includes(v ?? '');
const isNightWorld = (v: string | null): v is NightWorld => (NIGHT_WORLDS as readonly string[]).includes(v ?? '');
const isDaylight = (v: string | null): v is DaylightChoice => (DAYLIGHTS as readonly string[]).includes(v ?? '');

/**
 * The look to wear. A retired or unknown stored choice (a stored `map` included) wears the default. The stored
 * value is left alone, so if that look is ever brought back, people get their old pick back.
 */
export function loadTheme(): ActiveTheme {
  const v = read(KEY);
  return isOffered(v) ? v : DEFAULT_THEME;
}

/** The night world picked on this device (unknown or missing: the black star sky). */
export function loadWorld(): NightWorld {
  const v = read(WORLD_KEY);
  return isNightWorld(v) ? v : DEFAULT_WORLD;
}

export function loadDaylight(): DaylightChoice {
  const v = read(DAYLIGHT_KEY);
  return isDaylight(v) ? v : DEFAULT_DAYLIGHT;
}

export function loadSunPoint(): SunPoint | null {
  try {
    const p = JSON.parse(read(SUN_KEY) ?? 'null') as Partial<SunPoint> | null;
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat!) <= 90 && Math.abs(p.lon!) <= 180) {
      return { lat: p.lat!, lon: p.lon! };
    }
  } catch {
    // A broken value is no point at all.
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- sun

const RAD = Math.PI / 180;
/** The sun's centre this far below the horizon is sunrise and sunset (refraction and the sun's own radius). */
const HORIZON = -0.833;

/**
 * The sun's height above the horizon, in degrees, at a moment and a place (NOAA's solar position equations,
 * good to a minute or so of sunrise and sunset). Works on the device: nothing is asked of any server.
 */
export function sunElevation(at: number, lat: number, lon: number): number {
  const jd = at / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + centre - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  // The equation of time, in minutes.
  const eqTime =
    (4 / RAD) *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));
  const minutes = (((at % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const solarTime = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = solarTime / 4 - 180;
  const cosZenith = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle * RAD);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
}

export const isSunUp = (at: number, lat: number, lon: number) => sunElevation(at, lat, lon) > HORIZON;

/**
 * The next sunrise or sunset after `at`, on the whole minute just after it (so asking again a moment later
 * gives the same answer), or null when the sun neither rises nor sets in the next two days (midnight sun,
 * polar night): no limit on where a Lorer stands.
 */
export function nextSunTurn(at: number, lat: number, lon: number): number | null {
  const step = 10 * 60_000;
  const up = isSunUp(at, lat, lon);
  let a = at;
  for (let b = at + step; b <= at + 48 * 3_600_000; b += step) {
    if (isSunUp(b, lat, lon) !== up) {
      let lo = a;
      let hi = b;
      while (hi - lo > 1_000) {
        const mid = (lo + hi) / 2;
        if (isSunUp(mid, lat, lon) === up) lo = mid;
        else hi = mid;
      }
      return Math.ceil(hi / 60_000) * 60_000;
    }
    a = b;
  }
  return null;
}

/** The next sunrises and sunsets after `at` (six: about three days' worth, unless asked for more), in order. */
export function sunTurns(at: number, lat: number, lon: number, count = 6): number[] {
  const turns: number[] = [];
  let from = at;
  while (turns.length < count) {
    const turn = nextSunTurn(from, lat, lon);
    if (turn === null) break;
    turns.push(turn);
    from = turn + 60_000;
  }
  return turns;
}

/** Day or night for a choice. Following the sun without a place falls back to the phone. */
export function halfOfDay(choice: DaylightChoice, ctx: { now: number; point: SunPoint | null; phoneDark: boolean }): Half {
  if (choice === 'day') return 'day';
  if (choice === 'night') return 'night';
  if (choice === 'sun' && ctx.point) return isSunUp(ctx.now, ctx.point.lat, ctx.point.lon) ? 'day' : 'night';
  return ctx.phoneDark ? 'night' : 'day';
}

// --------------------------------------------------------------------------------------- the store

export interface Look {
  /** The night world picked on this device. */
  world: NightWorld;
  daylight: DaylightChoice;
  /** The world on screen now. */
  shown: WorldId;
  half: Half;
  /** Following the sun can work: the device knows where the Lorer stands. */
  sunKnown: boolean;
}

let pins = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let current: Look = {
  world: DEFAULT_WORLD,
  daylight: DEFAULT_DAYLIGHT,
  shown: DEFAULT_WORLD,
  half: 'night',
  sunKnown: false,
};
const listeners = new Set<() => void>();

const hasDom = () => typeof document !== 'undefined';
const phoneIsDark = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
};
/**
 * Welcome and "Where do you stand?" wear the default world with its compass rose (also before React mounts), and
 * so does any start before someone is signed in on this device (it is on its way to Welcome).
 */
const onFrontDoor = () => hasDom() && (/^\/welcome(\/|$)/.test(location.pathname) || read(IN_KEY) !== '1');
const inTemple = () => hasDom() && (location.pathname === '/oracle' || location.pathname.startsWith('/oracle/'));

/**
 * Works out the world for now and puts it on <html>. Cheap and idempotent: called on start, on every choice,
 * when the phone flips light/dark, when the app comes back to the front, and at sunrise and sunset.
 */
export function applyLook(now: number = Date.now()): Look {
  const world = loadWorld();
  const daylight = loadDaylight();
  const point = loadSunPoint();
  const natural = halfOfDay(daylight, { now, point, phoneDark: phoneIsDark() });
  const pinned = pins > 0 || onFrontDoor();
  const half: Half = pinned ? 'night' : natural;
  const shown: WorldId = pinned ? DEFAULT_WORLD : half === 'day' ? DAY_WORLD : world;

  if (hasDom()) {
    const root = document.documentElement;
    if (root.getAttribute('data-world') !== shown || root.getAttribute('data-daylight') !== half) {
      root.setAttribute('data-world', shown);
      root.setAttribute('data-daylight', half);
      // The native shell (lib/native.ts) re-styles the status bar when data-theme is written; writing it again
      // tells it about the new world too.
      const theme = root.getAttribute('data-theme');
      if (theme) root.setAttribute('data-theme', theme);
    }
    if (!inTemple()) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', WORLD_BAR[shown]);
  }

  // Sunrise and sunset: wake at the next one, and leave the answer (and the next week of turns) for index.html's
  // next first paint, so a start after a sunset is already night. When fewer turns come (the edge of the
  // midnight sun or the polar night), the last half holds at least two more days. Written only when it changed:
  // every tab writes this cache, and none reacts to another's (startLook).
  clearTimeout(timer);
  timer = undefined;
  if (daylight === 'sun' && point) {
    const turns = sunTurns(now, point.lat, point.lon, SUN_TURNS);
    const last = turns.length ? turns[turns.length - 1]! : Math.floor(now / 60_000) * 60_000;
    const until = turns.length === SUN_TURNS ? last : last + 48 * 3_600_000;
    const value = JSON.stringify({ day: natural === 'day', turns, until });
    if (read(SUN_NOW_KEY) !== value) write(SUN_NOW_KEY, value);
    if (hasDom()) timer = setTimeout(() => applyLook(), Math.min((turns[0] ?? until) - now + 5_000, 6 * 3_600_000));
  }

  const next: Look = { world, daylight, shown, half, sunKnown: !!point };
  if (
    next.world !== current.world ||
    next.daylight !== current.daylight ||
    next.shown !== current.shown ||
    next.half !== current.half ||
    next.sunKnown !== current.sunKnown
  ) {
    current = next;
    for (const fn of listeners) fn();
  }
  return current;
}

/** Keeps the world in step with the phone's light/dark switch, the app coming to the front, and other tabs. */
export function startLook(): () => void {
  if (!hasDom()) return () => undefined;
  const again = () => applyLook();
  const onVisible = () => {
    if (document.visibilityState === 'visible') applyLook();
  };
  // Another tab changed a choice. Not the sun's cache: every tab writes that, so reacting to it would have two
  // tabs answer each other forever.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SUN_NOW_KEY) return;
    if (e.key === null || e.key.startsWith('lore.')) applyLook();
  };
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', again);
  } catch {
    media = null;
  }
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('storage', onStorage);
  applyLook();
  return () => {
    media?.removeEventListener('change', again);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('storage', onStorage);
    clearTimeout(timer);
    timer = undefined;
  };
}

export function getLook(): Look {
  return current;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current world and choices, re-rendering when they change. */
export function useLook(): Look {
  return useSyncExternalStore(subscribe, getLook, getLook);
}

/** Welcome and "Where do you stand?": wear the default night world (and its compass rose) while mounted. */
export function useFrontDoorWorld() {
  useEffect(() => {
    pins++;
    applyLook();
    return () => {
      pins--;
      applyLook();
    };
  }, []);
}

/** Someone picked a night world in Profile: wear it now and remember it. */
export function chooseWorld(world: NightWorld) {
  write(WORLD_KEY, world);
  applyLook();
}

/** Someone picked when it's day in Profile. */
export function chooseDaylight(choice: DaylightChoice) {
  write(DAYLIGHT_KEY, choice);
  applyLook();
}

/** Where the Lorer stands (the Loracle's home point), or null when unknown or signed out. */
export function setSunPoint(point: SunPoint | null) {
  const round = (x: number) => Math.round(x * 10) / 10;
  const value = point ? JSON.stringify({ lat: round(point.lat), lon: round(point.lon) }) : null;
  if (value === read(SUN_KEY)) return;
  write(SUN_KEY, value);
  if (!value) write(SUN_NOW_KEY, null);
  applyLook();
}

/** Someone is (or no one is) signed in on this device: the first-paint hint (IN_KEY). World.tsx keeps it. */
export function setSignedIn(signedIn: boolean) {
  const value = signedIn ? '1' : null;
  if (read(IN_KEY) === value) return;
  write(IN_KEY, value);
  applyLook();
}

// ------------------------------------------------------------------------------------------- looks

/** Crazy (retired): paint everything on screen again in new random colours. */
export const rollColors = rollCrazy;

/** Puts a look on the page. Doesn't save it (main.tsx calls this on every start). */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  if (choice === 'crazy') startCrazy();
  else stopCrazy();
  if (choice === 'lore') applyLook();
}

/** Someone picked a look in Profile: wear it and remember it. */
export function chooseTheme(choice: ActiveTheme) {
  applyTheme(choice);
  write(KEY, choice);
}

/**
 * Dark-looking themes want light status bar icons. Every world is dark at the top, the green hills too (a deep
 * blue sky over the sun), so LORE always does.
 */
export function isDarkTheme(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'lore' || theme === 'dark') return true;
  if (theme === 'map' || theme === 'light' || theme === 'crazy') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Exported for tests: forget the store's state between cases. */
export function resetLookForTests() {
  pins = 0;
  clearTimeout(timer);
  timer = undefined;
  current = { world: DEFAULT_WORLD, daylight: DEFAULT_DAYLIGHT, shown: DEFAULT_WORLD, half: 'night', sunKnown: false };
}

/** The keys this module stores under (index.html's boot script reads the same ones). */
export const STORAGE_KEYS = {
  theme: KEY,
  world: WORLD_KEY,
  daylight: DAYLIGHT_KEY,
  sun: SUN_KEY,
  sunNow: SUN_NOW_KEY,
  signedIn: IN_KEY,
} as const;
